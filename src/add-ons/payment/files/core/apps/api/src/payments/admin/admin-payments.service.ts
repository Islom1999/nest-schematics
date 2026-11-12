import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Readable } from 'stream';
import { Repository, SelectQueryBuilder } from 'typeorm';
import { BaseCrudService, PaginatedResult, runTableQuery, TableQueryDto, TableQueryOptions } from '@app/common';
import { PaymentInvoice, PaymentStatus, PaymentTransaction } from '@app/database';
import { PaymentProviderRegistry } from '../payment-provider';
import { PaymentError } from '../payment-state';
import { PaymentsService } from '../payments.service';
import {
  CancelPaymentDto,
  ExportPaymentsQueryDto,
  PaymentInvoiceDetailDto,
  PaymentPeriodQueryDto,
  PaymentSummaryDto,
} from './admin-payments.dto';
import { csvLine, PAYMENT_CSV_COLUMNS, paymentCsvRow, PaymentSummaryRow, summarizePayments } from './payments-report';

/** Most rows one CSV export holds; narrow the filters for more (`X-Export-Truncated: true`). */
export const PAYMENT_EXPORT_MAX_ROWS = 50_000;
/** Rows read per query while streaming an export. */
const EXPORT_CHUNK = 1000;

const INVOICE_TABLE: TableQueryOptions = {
  searchFields: ['number', 'provider', 'targetType', 'targetId'],
  defaultSort: { field: 'createdAt', order: 'DESC' },
};

export interface PaymentExport {
  /** Rows matching the filters. */
  total: number;
  /** total > PAYMENT_EXPORT_MAX_ROWS: only the first rows are in the file. */
  truncated: boolean;
  stream: Readable;
}

/**
 * `admin/payments`: the transactions table, manual cancel, invoices, the
 * summary and the CSV export.
 * - pending: cancelled here (the provider's later perform/complete is refused);
 * - paid: only for providers with `manualRefund` (Click), after the money was
 *   returned in the provider's cabinet (`refundedExternally: true`); the
 *   wallet top-up / target is reversed like a provider cancel. Payme refunds
 *   are made in the Payme Business cabinet, which then calls CancelTransaction.
 */
@Injectable()
export class AdminPaymentsService extends BaseCrudService<PaymentTransaction> {
  protected override alias = 'payment';
  protected override notFoundMessage = 'Payment not found';

  constructor(
    @InjectRepository(PaymentTransaction) repository: Repository<PaymentTransaction>,
    @InjectRepository(PaymentInvoice) private readonly invoices: Repository<PaymentInvoice>,
    private readonly payments: PaymentsService,
    private readonly providers: PaymentProviderRegistry,
  ) {
    super(repository);
    this.tableOptions = {
      searchFields: ['externalId', 'account', 'provider', 'targetId'],
      defaultSort: { field: 'createdAt', order: 'DESC' },
    };
  }

  async cancel(id: string, dto: CancelPaymentDto, adminId: string): Promise<PaymentTransaction> {
    const tx = await this.payments.findById(id);
    if (!tx) throw new NotFoundException(this.notFoundMessage);
    const adapter = this.providers.get(tx.provider);
    if (!adapter) throw new ConflictException(`Provider "${tx.provider}" is not installed`);
    const paid = tx.status === PaymentStatus.PAID;
    if (paid && !adapter.manualRefund) throw new ConflictException(adapter.refundHint);
    if (paid && dto.refundedExternally !== true) {
      throw new BadRequestException('Return the money in the provider cabinet first, then send refundedExternally: true');
    }
    if (!paid && tx.status !== PaymentStatus.PENDING) throw new ConflictException(`The payment is ${tx.status} already`);
    try {
      return await this.payments.transition(tx.id, PaymentStatus.CANCELLED, {
        state: (from) => adapter.cancelState(from === PaymentStatus.PAID),
        // The status checked above must still hold (a callback may have come in between).
        onlyFrom: [tx.status],
        raw: { adminCancel: { adminId, comment: dto.comment, refundedExternally: paid, at: new Date().toISOString() } },
      });
    } catch (error) {
      if (error instanceof PaymentError) throw new ConflictException(error.message);
      throw error;
    }
  }

  // ── Invoices ──────────────────────────────────────────────────────────

  findInvoices(query: TableQueryDto): Promise<PaginatedResult<PaymentInvoice>> {
    return runTableQuery(this.invoices.createQueryBuilder('invoice'), query, INVOICE_TABLE);
  }

  async findInvoice(id: string): Promise<PaymentInvoiceDetailDto> {
    const invoice = await this.invoices.findOne({ where: { id } });
    if (!invoice) throw new NotFoundException('Invoice not found');
    const transactions = await this.repository.find({ where: { invoiceId: id }, order: { createdAt: 'ASC' } });
    return Object.assign(new PaymentInvoiceDetailDto(), invoice, { transactions });
  }

  // ── Summary and export ────────────────────────────────────────────────

  /** One aggregate query (`GROUP BY status, provider`), rolled up in summarizePayments(). */
  async summary(query: PaymentPeriodQueryDto): Promise<PaymentSummaryDto> {
    const qb = this.repository
      .createQueryBuilder(this.alias)
      .select(`${this.alias}.status`, 'status')
      .addSelect(`${this.alias}.provider`, 'provider')
      .addSelect('COUNT(*)', 'count')
      .addSelect(`COALESCE(SUM(${this.alias}.amount), 0)`, 'amount')
      .groupBy(`${this.alias}.status`)
      .addGroupBy(`${this.alias}.provider`);
    this.applyPeriod(qb, query);
    const rows = await qb.getRawMany<PaymentSummaryRow>();
    return summarizePayments(rows, { from: query.from ?? null, to: query.to ?? null, provider: query.provider ?? null });
  }

  /**
   * CSV of the transactions matching the list filters, read in chunks of
   * EXPORT_CHUNK while the response streams, at most PAYMENT_EXPORT_MAX_ROWS.
   * Rows created after the export started are left out, so chunks do not shift.
   */
  async exportCsv(query: ExportPaymentsQueryDto): Promise<PaymentExport> {
    const table: TableQueryDto = {
      filters: parseFilters(query.filters),
      globalFilter: query.globalFilter,
      sortField: query.sortField,
      sortOrder: query.sortOrder,
    };
    const qb = this.repository
      .createQueryBuilder(this.alias)
      .select(PAYMENT_CSV_COLUMNS.map((column) => `${this.alias}.${column}`))
      .andWhere(`${this.alias}.createdAt <= :exportedAt`, { exportedAt: new Date() });
    this.applyPeriod(qb, query);
    if (query.status) qb.andWhere(`${this.alias}.status = :status`, { status: query.status });
    // Validates the filters (400 on unknown fields) and counts; it leaves the filters and sort on qb.
    const { count } = await runTableQuery(qb, { ...table, first: 0, rows: 1 }, this.tableOptions);
    const limit = Math.min(count, PAYMENT_EXPORT_MAX_ROWS);
    qb.addOrderBy(`${this.alias}.id`, 'ASC'); // stable pages when the sort column has ties

    async function* lines(): AsyncGenerator<string> {
      yield csvLine(PAYMENT_CSV_COLUMNS);
      for (let offset = 0; offset < limit; offset += EXPORT_CHUNK) {
        const rows = await qb
          .skip(offset)
          .take(Math.min(EXPORT_CHUNK, limit - offset))
          .getMany();
        if (!rows.length) return;
        yield rows.map(paymentCsvRow).join('');
      }
    }
    return { total: count, truncated: count > PAYMENT_EXPORT_MAX_ROWS, stream: Readable.from(lines()) };
  }

  private applyPeriod(qb: SelectQueryBuilder<PaymentTransaction>, query: PaymentPeriodQueryDto): void {
    const from = query.from ? new Date(query.from) : null;
    const to = query.to ? new Date(query.to) : null;
    if (from && to && from >= to) throw new BadRequestException('from must be before to');
    if (from) qb.andWhere(`${this.alias}.createdAt >= :from`, { from });
    if (to) qb.andWhere(`${this.alias}.createdAt < :to`, { to });
    if (query.provider) qb.andWhere(`${this.alias}.provider = :provider`, { provider: query.provider });
  }
}

function parseFilters(json: string | undefined): TableQueryDto['filters'] {
  if (!json) return undefined;
  let value: unknown;
  try {
    value = JSON.parse(json);
  } catch {
    throw new BadRequestException('filters must be JSON');
  }
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new BadRequestException('filters must be a JSON object');
  return value as TableQueryDto['filters'];
}
