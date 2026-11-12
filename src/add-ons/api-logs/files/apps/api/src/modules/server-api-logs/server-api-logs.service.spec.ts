import { Repository } from 'typeorm';
import { ServerApiLog } from '@app/database';
import { csvCell, csvRow } from './csv';
import { ServerApiLogsService } from './server-api-logs.service';

function row(i: number, extra: Partial<ServerApiLog> = {}): ServerApiLog {
  return {
    id: `id-${i}`,
    createdAt: new Date(Date.UTC(2025, 0, 1, 0, 0, i)),
    type: 'API',
    module: 'ProductController',
    handler: 'create',
    method: 'POST',
    url: `/api/admin/product?n=${i}`,
    statusCode: 500,
    durationMs: i,
    userId: null,
    userType: null,
    ip: '127.0.0.1',
    requestId: `req-${i}`,
    serverId: 'host',
    error: null,
    requestBody: { password: '***' },
    responseBody: null,
    ...extra,
  } as unknown as ServerApiLog;
}

class TestService extends ServerApiLogsService {
  pages: { first: number; rows: number; filters: unknown }[] = [];
  constructor(private readonly all: ServerApiLog[]) {
    super({ metadata: { findColumnWithPropertyName: () => undefined } } as unknown as Repository<ServerApiLog>);
  }
  protected override fetchPage(query: { first?: number; rows?: number; filters?: unknown }) {
    this.pages.push({ first: query.first ?? 0, rows: query.rows ?? 0, filters: query.filters });
    const first = query.first ?? 0;
    return Promise.resolve({ count: this.all.length, data: this.all.slice(first, first + (query.rows ?? 10)) });
  }
}

async function read(stream: AsyncIterable<string | Buffer>): Promise<string> {
  let text = '';
  for await (const chunk of stream) text += chunk.toString();
  return text;
}

describe('csv cells', () => {
  it('prefixes cells that start a formula and quotes special characters', () => {
    for (const bad of ['=SUM(A1)', '+1+1', '-2+3', '@cmd', '\tx', '\rx']) expect(csvCell(bad)).toMatch(/^"?'/);
    expect(csvCell('=HYPERLINK("http://x")')).toBe(`"'=HYPERLINK(""http://x"")"`);
    expect(csvCell('a,b')).toBe('"a,b"');
    expect(csvCell('line\nbreak')).toBe('"line\nbreak"');
    expect(csvCell('/api/x?a=1')).toBe('/api/x?a=1');
    expect(csvCell(null)).toBe('');
    expect(csvCell(-5)).toBe('-5');
    expect(csvCell(new Date(0))).toBe('1970-01-01T00:00:00.000Z');
    expect(csvRow(['a', 1, null])).toBe('a,1,\r\n');
  });
});

describe('ServerApiLogsService.exportCsv', () => {
  it('writes a header and one line per row, without bodies', async () => {
    const service = new TestService([row(1), row(2, { error: '=cmd|calc' })]);
    const { stream, filename } = await service.exportCsv({}, new Date('2025-02-03T04:05:06Z'));
    const lines = (await read(stream)).split('\r\n');
    expect(filename).toBe('server-api-logs-2025-02-03-04-05-06.csv');
    expect(lines[0]).toBe('\uFEFFcreatedAt,id,type,module,handler,method,url,statusCode,durationMs,userId,userType,ip,requestId,serverId,error');
    expect(lines).toHaveLength(4);
    expect(lines[2].endsWith(",'=cmd|calc")).toBe(true);
    expect(lines.join('')).not.toContain('password');
  });

  it('reads pages of 100 and stops at the limit', async () => {
    const all = Array.from({ length: 250 }, (_, i) => row(i));
    const service = new TestService(all);
    const { stream } = await service.exportCsv({ limit: 150 });
    const lines = (await read(stream)).split('\r\n').filter(Boolean);
    expect(lines).toHaveLength(1 + 150);
    expect(service.pages.map((p) => [p.first, p.rows])).toEqual([
      [0, 100],
      [100, 50],
    ]);
  });

  it('pins the query to the moment the export started (new rows do not shift pages)', async () => {
    const service = new TestService(Array.from({ length: 3 }, (_, i) => row(i)));
    const now = new Date('2025-03-01T00:00:00Z');
    const { stream } = await service.exportCsv({ filters: { statusCode: { value: 500 } } }, now);
    await read(stream);
    expect(service.pages[0].filters).toEqual({
      statusCode: { value: 500 },
      __exportSnapshot: { value: '2025-03-01T00:00:00.000Z' },
    });
  });
});
