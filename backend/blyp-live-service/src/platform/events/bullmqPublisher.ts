import { Queue } from 'bullmq';
import { getBullmqRedis } from '../../economy/infra';
import type { DomainEventEnvelope, DomainEventPublisher } from './outbox';

export class BullMqDomainEventPublisher implements DomainEventPublisher {
  private readonly queue: Queue<DomainEventEnvelope>;

  constructor(queueName = process.env.DOMAIN_EVENT_QUEUE || 'blyp-domain-events-v1') {
    this.queue = new Queue<DomainEventEnvelope>(queueName, {
      connection: getBullmqRedis(),
      defaultJobOptions: {
        removeOnComplete: { count: 10_000 },
        removeOnFail: false,
      },
    });
  }

  async publish(event: DomainEventEnvelope): Promise<void> {
    await this.queue.add(event.eventType, event, {
      jobId: event.eventId,
      attempts: 1,
    });
  }

  async close(): Promise<void> {
    await this.queue.close();
  }
}
