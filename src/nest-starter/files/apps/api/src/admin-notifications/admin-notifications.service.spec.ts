import { NotFoundException } from '@nestjs/common';
import { AdminNotificationsService } from './admin-notifications.service';

const row = (over: Record<string, unknown> = {}) => ({
  id: 'n1',
  adminId: 'a1',
  title: 'Hello',
  description: null,
  icon: null,
  link: '/admins',
  readAt: null,
  createdAt: new Date('2026-01-01T00:00:00Z'),
  ...over,
});

describe('AdminNotificationsService', () => {
  it('lists the admin\'s own notifications newest first as the UI shape', async () => {
    const repository = { find: jest.fn().mockResolvedValue([row(), row({ id: 'n2', readAt: new Date() })]) };
    const list = await new AdminNotificationsService(repository as never).list('a1');
    expect(repository.find).toHaveBeenCalledWith(
      expect.objectContaining({ where: { adminId: 'a1' }, order: { createdAt: 'DESC' }, take: 50 }),
    );
    expect(list.map((n) => [n.id, n.read])).toEqual([['n1', false], ['n2', true]]);
    expect(list[0]).toMatchObject({ title: 'Hello', link: '/admins', time: new Date('2026-01-01T00:00:00Z') });
  });

  it('marks only an unread notification of that admin, and 404s for someone else\'s', async () => {
    const repository = {
      update: jest.fn().mockResolvedValue(undefined),
      findOne: jest.fn().mockResolvedValueOnce(row({ readAt: new Date() })).mockResolvedValueOnce(null),
    };
    const service = new AdminNotificationsService(repository as never);
    await expect(service.markRead('a1', 'n1')).resolves.toMatchObject({ id: 'n1', read: true });
    expect(repository.update.mock.calls[0][0]).toMatchObject({ id: 'n1', adminId: 'a1' });
    await expect(service.markRead('a2', 'n1')).rejects.toBeInstanceOf(NotFoundException);
  });

  it('notify stores a trimmed title for the admin', async () => {
    const repository = { insert: jest.fn().mockResolvedValue(undefined) };
    await new AdminNotificationsService(repository as never).notify('a1', { title: 'x'.repeat(300), link: '/a' });
    const saved = repository.insert.mock.calls[0][0];
    expect(saved).toMatchObject({ adminId: 'a1', description: null, icon: null, link: '/a' });
    expect(saved.title).toHaveLength(200);
  });
});
