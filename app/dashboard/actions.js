'use server';

import db from '@/lib/db';
import { revalidatePath } from 'next/cache';

export async function updateReviewStatus(sessionId, key, value) {
    const client = await db.connect();
    try {
        // key is either 'questions_checked' or 'answers_checked'
        // We need to merge this into the existing meta_json

        // 1. Fetch current meta
        const res = await client.query('SELECT meta_json FROM paper_session WHERE paper_session_id = $1', [sessionId]);
        let currentMeta = {};
        if (res.rows.length > 0 && res.rows[0].meta_json) {
            currentMeta = res.rows[0].meta_json;
        }

        // 2. Update
        currentMeta[key] = value;

        // 3. Save
        await client.query('UPDATE paper_session SET meta_json = $1 WHERE paper_session_id = $2', [currentMeta, sessionId]);

        revalidatePath('/dashboard');
    } catch (e) {
        console.error("Error updating review status:", e);
        throw e;
    } finally {
        client.release();
    }
}

export async function updatePdfLink(sessionId, link) {
    const client = await db.connect();
    try {
        const res = await client.query('SELECT meta_json FROM paper_session WHERE paper_session_id = $1', [sessionId]);
        let currentMeta = {};
        if (res.rows.length > 0 && res.rows[0].meta_json) {
            currentMeta = res.rows[0].meta_json;
        }

        currentMeta['pdf_link'] = link;

        await client.query('UPDATE paper_session SET meta_json = $1 WHERE paper_session_id = $2', [currentMeta, sessionId]);
        revalidatePath('/dashboard');
    } catch (e) {
        console.error("Error updating pdf link:", e);
        throw e;
    } finally {
        client.release();
    }
}
