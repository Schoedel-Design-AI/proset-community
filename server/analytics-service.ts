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

export async function getAnalytics(timeRange: string = '30d') {
  const days = timeRange === '7d' ? 7 : timeRange === '90d' ? 90 : timeRange === '1y' ? 365 : 30;
  const since = new Date();
  since.setDate(since.getDate() - days);
  const sinceStr = since.toISOString();

  const [
    totalUsers,
    newUsers,
    totalRecordings,
    newRecordings,
    activeUsers,
    conversionStats,
    dailySignups,
    dailyRecordings,
    dailyActiveUsers,
    topConversionTypes,
    userRetention,
    recentEvents,
  ] = await Promise.all([
    pool.query(`SELECT COUNT(*) as count FROM users`),

    pool.query(`SELECT COUNT(*) as count FROM users WHERE created_at >= $1`, [sinceStr]),

    pool.query(`SELECT COUNT(*) as count FROM recordings`),

    pool.query(`SELECT COUNT(*) as count FROM recordings WHERE created_at >= $1`, [sinceStr]),

    pool.query(
      `SELECT COUNT(DISTINCT user_id) as count FROM usage_events 
       WHERE created_at >= $1 AND event_type IN ('recording_created', 'transcription_completed', 'conversion_completed')`,
      [sinceStr]
    ),

    pool.query(
      `SELECT COUNT(*) as count FROM usage_events 
       WHERE event_type = 'conversion_completed' AND created_at >= $1`,
      [sinceStr]
    ),

    pool.query(
      `SELECT DATE(created_at) as date, COUNT(*) as count 
       FROM users WHERE created_at >= $1 
       GROUP BY DATE(created_at) ORDER BY date`,
      [sinceStr]
    ),

    pool.query(
      `SELECT DATE(created_at) as date, COUNT(*) as count 
       FROM recordings WHERE created_at >= $1 
       GROUP BY DATE(created_at) ORDER BY date`,
      [sinceStr]
    ),

    pool.query(
      `SELECT DATE(created_at) as date, COUNT(DISTINCT user_id) as count 
       FROM usage_events 
       WHERE created_at >= $1 AND event_type IN ('recording_created', 'transcription_completed', 'conversion_completed')
       GROUP BY DATE(created_at) ORDER BY date`,
      [sinceStr]
    ),

    pool.query(
      `SELECT metadata->>'conversionType' as type, COUNT(*) as count 
       FROM usage_events 
       WHERE event_type = 'conversion_completed' AND created_at >= $1 AND metadata->>'conversionType' IS NOT NULL
       GROUP BY metadata->>'conversionType' ORDER BY count DESC LIMIT 15`,
      [sinceStr]
    ),

    pool.query(
      `WITH first_seen AS (
        SELECT user_id, MIN(DATE(created_at)) as first_date
        FROM usage_events WHERE event_type IN ('recording_created', 'conversion_completed')
        GROUP BY user_id
      ),
      return_visits AS (
        SELECT fs.user_id, fs.first_date,
          CASE WHEN EXISTS (
            SELECT 1 FROM usage_events ue 
            WHERE ue.user_id = fs.user_id 
            AND DATE(ue.created_at) > fs.first_date + INTERVAL '1 day'
            AND DATE(ue.created_at) <= fs.first_date + INTERVAL '7 days'
          ) THEN 1 ELSE 0 END as returned_week1,
          CASE WHEN EXISTS (
            SELECT 1 FROM usage_events ue 
            WHERE ue.user_id = fs.user_id 
            AND DATE(ue.created_at) > fs.first_date + INTERVAL '7 days'
            AND DATE(ue.created_at) <= fs.first_date + INTERVAL '30 days'
          ) THEN 1 ELSE 0 END as returned_month1
        FROM first_seen fs
      )
      SELECT 
        COUNT(*) as total_users,
        SUM(returned_week1) as returned_week1,
        SUM(returned_month1) as returned_month1
      FROM return_visits`
    ),

    pool.query(
      `SELECT event_type, COUNT(*) as count 
       FROM usage_events WHERE created_at >= $1 
       GROUP BY event_type ORDER BY count DESC`,
      [sinceStr]
    ),
  ]);

  return {
    overview: {
      totalUsers: parseInt(totalUsers.rows[0].count),
      newUsers: parseInt(newUsers.rows[0].count),
      totalRecordings: parseInt(totalRecordings.rows[0].count),
      newRecordings: parseInt(newRecordings.rows[0].count),
      activeUsers: parseInt(activeUsers.rows[0].count),
      totalConversions: parseInt(conversionStats.rows[0].count),
    },
    charts: {
      dailySignups: dailySignups.rows.map((r: any) => ({ date: r.date, count: parseInt(r.count) })),
      dailyRecordings: dailyRecordings.rows.map((r: any) => ({ date: r.date, count: parseInt(r.count) })),
      dailyActiveUsers: dailyActiveUsers.rows.map((r: any) => ({ date: r.date, count: parseInt(r.count) })),
    },
    topConversionTypes: topConversionTypes.rows.map((r: any) => ({ type: r.type, count: parseInt(r.count) })),
    retention: {
      totalTracked: parseInt(userRetention.rows[0]?.total_users || '0'),
      returnedWeek1: parseInt(userRetention.rows[0]?.returned_week1 || '0'),
      returnedMonth1: parseInt(userRetention.rows[0]?.returned_month1 || '0'),
    },
    eventBreakdown: recentEvents.rows.map((r: any) => ({ type: r.event_type, count: parseInt(r.count) })),
  };
}

export async function getUsersList(options: { page?: number; limit?: number; search?: string } = {}) {
  const page = options.page || 1;
  const limit = Math.min(options.limit || 25, 100);
  const offset = (page - 1) * limit;

  let query = `
    SELECT u.id, u.email, u.first_name, u.job_type, u.user_number, u.created_at,
      u.email_verified, u.role, u.cached_tier, u.cloud_sync_enabled,
      u.friends_of_barry_granted_at, u.friends_of_barry_expires_at,
      0 as recording_count, NULL as last_recording_at
    FROM users u
  `;
  const params: any[] = [];

  if (options.search) {
    params.push(`%${options.search}%`);
    query += ` WHERE u.email ILIKE $${params.length} OR u.first_name ILIKE $${params.length} OR u.id ILIKE $${params.length} OR CAST(u.user_number AS TEXT) ILIKE $${params.length}`;
  }

  const countQuery = `SELECT COUNT(*) as total FROM users${options.search ? ` WHERE email ILIKE $1 OR first_name ILIKE $1 OR id ILIKE $1 OR CAST(user_number AS TEXT) ILIKE $1` : ''}`;
  const countResult = await pool.query(countQuery, options.search ? [`%${options.search}%`] : []);
  const total = parseInt(countResult.rows[0].total);

  params.push(limit, offset);
  query += ` ORDER BY u.created_at DESC LIMIT $${params.length - 1} OFFSET $${params.length}`;

  const result = await pool.query(query, params);

  return {
    users: result.rows,
    total,
    page,
    totalPages: Math.ceil(total / limit),
  };
}
