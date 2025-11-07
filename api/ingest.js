// api/ingest.js — Vercel Serverless (Node)
import { createClient } from '@supabase/supabase-js';

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_KEY; // set in Vercel env

const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  // Optional API key check
  const apiKey = process.env.INGEST_API_KEY;
  if (apiKey) {
    const key = req.headers['x-api-key'] || req.query.apiKey;
    if (!key || key !== apiKey) return res.status(401).json({ error: 'Unauthorized' });
  }

  const record = req.body;
  if (!record || !record.id) return res.status(400).json({ error: 'Invalid record' });

  try {
    const payload = {
      id: record.id,
      ts: record.ts || new Date().toISOString(),
      url: record.url || null,
      origin: record.origin || null,
      title: record.title || null,
      transfer_bytes: Number(record.transferBytes || record.transfer_bytes || 0),
      resource_count: Number(record.resourceCount || record.resource_count || 0),
      load_time_ms: Number(record.loadTimeMs || record.load_time_ms || 0),
      estimated_co2_g: Number(record.estimatedCO2_g || record.estimated_co2_g || 0),
      raw: record
    };
    const { error } = await supabase.from('visits').insert([payload]);
    if (error) {
      console.error('supabase insert error', error);
      return res.status(500).json({ error: 'DB insert failed' });
    }
    return res.json({ status: 'ok' });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: 'server error' });
  }
}