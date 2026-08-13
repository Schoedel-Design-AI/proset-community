import { pool } from './storage';
export type EventType =
  | 'user_signup'
  | 'user_login'
  | 'user_email_verified'
  | 'recording_created'
  | 'recording_deleted'
  | 'transcription_completed'
  | 'conversion_completed'
  | 'export_completed'
  | 'subscription_created'
  | 'subscription_cancelled'
  | 'pro_access_checkout'
  | 'cloud_sync_checkout'
  | 'backup_completed'
  | 'thought_thread_created'
  | 'thought_thread_deleted'
  | 'thought_thread_recordings_added'
  | 'thought_thread_context_added'
  | 'thought_thread_conversion_prepared'
  | 'thought_thread_conversion_completed'
  | 'thought_thread_conversion_failed';

export async function trackEvent(eventType: EventType, userId?: string, metadata?: Record<string, any>) {
  try {
    await pool.query(
      `INSERT INTO usage_events (event_type, user_id, metadata) VALUES ($1, $2, $3)`,
      [eventType, userId || null, metadata ? JSON.stringify(metadata) : null]
    );
  } catch (err) {
    console.error('Failed to track event:', err);
  }
}

