import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Column, Entity, Index, JoinColumn, ManyToOne } from 'typeorm';
import { BaseEntity } from '../base.entity';
import { AiChatSession } from './ai-chat-session.entity';

export enum AiChatRole {
  USER = 'user',
  ASSISTANT = 'assistant',
}

export enum AiChatMessageStatus {
  /** The answer is being streamed. */
  STREAMING = 'streaming',
  COMPLETE = 'complete',
  /** The provider failed mid-answer: `content` holds the partial text. */
  ERROR = 'error',
  /** The client disconnected: `content` holds the partial text. */
  ABORTED = 'aborted',
}

/** One message of an AI chat session. Schema: migration `*-ai-chat.ts`. */
@Entity({ name: 'ai_chat_messages' })
@Index('IDX_ai_chat_messages_session_id_created_at', ['sessionId', 'createdAt'])
export class AiChatMessage extends BaseEntity {
  @ApiProperty({ format: 'uuid' })
  @Column({ type: 'uuid' })
  sessionId: string;

  @ManyToOne(() => AiChatSession, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'session_id', foreignKeyConstraintName: 'FK_ai_chat_messages_session_id' })
  session?: AiChatSession;

  @ApiProperty({ enum: AiChatRole, enumName: 'AiChatRole' })
  @Column({ type: 'varchar', length: 16 })
  role: AiChatRole;

  @ApiProperty()
  @Column({ type: 'text', default: '' })
  content: string;

  @ApiProperty({ enum: AiChatMessageStatus, enumName: 'AiChatMessageStatus' })
  @Column({ type: 'varchar', length: 16, default: AiChatMessageStatus.COMPLETE })
  status: AiChatMessageStatus;

  @ApiPropertyOptional({ type: String, nullable: true })
  @Column({ type: 'varchar', length: 128, nullable: true })
  model: string | null;

  @ApiProperty({ type: Number })
  @Column({ type: 'int', default: 0 })
  promptTokens: number;

  @ApiProperty({ type: Number })
  @Column({ type: 'int', default: 0 })
  completionTokens: number;

  @ApiPropertyOptional({ type: String, nullable: true })
  @Column({ type: 'text', nullable: true })
  error: string | null;
}
