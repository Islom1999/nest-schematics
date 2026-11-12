import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Column, Entity, Index } from 'typeorm';
import { BaseEntity } from '../base.entity';

/**
 * One AI chat conversation of a user (`npm run g -- ai --chat`). Deleting a
 * session deletes its messages. Schema: migration `*-ai-chat.ts`.
 */
@Entity({ name: 'ai_chat_sessions' })
@Index('IDX_ai_chat_sessions_user_id_last_message_at', ['userId', 'lastMessageAt'])
export class AiChatSession extends BaseEntity {
  @ApiProperty({ description: 'Owner (client user id)' })
  @Column({ type: 'varchar', length: 64 })
  userId: string;

  @ApiProperty({ example: 'Recipe ideas for dinner' })
  @Column({ type: 'varchar', length: 200, default: '' })
  title: string;

  @ApiProperty({ example: 'default', description: 'System prompt file (prompts/<name>.md)' })
  @Column({ type: 'varchar', length: 64, default: 'default' })
  prompt: string;

  @ApiPropertyOptional({ type: String, nullable: true, description: 'Model of the last answer' })
  @Column({ type: 'varchar', length: 128, nullable: true })
  model: string | null;

  @ApiProperty({ type: Number })
  @Column({ type: 'int', default: 0 })
  messageCount: number;

  @ApiPropertyOptional({ type: String, format: 'date-time', nullable: true })
  @Column({ type: 'timestamptz', nullable: true })
  lastMessageAt: Date | null;
}
