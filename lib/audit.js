/**
 * Audit logging utilities for tracking user actions
 */

import pool from './db.js';

/**
 * Log a question edit
 */
export async function logQuestionEdit(userId, questionId, action, changes) {
    try {
        await pool.query(
            `INSERT INTO audit_log (user_id, question_id, action, changes)
       VALUES ($1, $2, $3, $4)`,
            [userId, questionId, action, JSON.stringify(changes)]
        );
    } catch (error) {
        console.error('Error logging audit:', error);
    }
}

/**
 * Get audit history for a question
 */
export async function getQuestionHistory(questionId) {
    const result = await pool.query(
        `SELECT a.*, u.name as user_name, u.email as user_email
     FROM audit_log a
     LEFT JOIN users u ON a.user_id = u.id
     WHERE a.question_id = $1
     ORDER BY a.timestamp DESC
     LIMIT 50`,
        [questionId]
    );
    return result.rows;
}

/**
 * Get recent activity for a user
 */
export async function getUserActivity(userId, limit = 20) {
    const result = await pool.query(
        `SELECT *
     FROM audit_log
     WHERE user_id = $1
     ORDER BY timestamp DESC
     LIMIT $2`,
        [userId, limit]
    );
    return result.rows;
}

/**
 * Get all recent activity (admin only)
 */
export async function getAllActivity(limit = 50) {
    const result = await pool.query(
        `SELECT a.*, u.name as user_name, u.email as user_email
     FROM audit_log a
     LEFT JOIN users u ON a.user_id = u.id
     ORDER BY a.timestamp DESC
     LIMIT $1`,
        [limit]
    );
    return result.rows;
}
