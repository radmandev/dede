// @ts-nocheck
import { createClient } from '@supabase/supabase-js';

const env = typeof import.meta !== 'undefined' && import.meta.env ? import.meta.env : process.env;
const SUPABASE_URL = env.VITE_SUPABASE_URL || 'https://joiodrhhvhxmushujxze.supabase.co';
const SUPABASE_ANON_KEY = env.VITE_SUPABASE_ANON_KEY || 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImpvaW9kcmhodmh4bXVzaHVqeHplIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODA1NjUwMDgsImV4cCI6MjA5NjE0MTAwOH0.QEY6CjZvmyznF4HLoEdNjmiNIxlX-dVAtkEwxIjuwUU';
const STORAGE_BUCKET = env.VITE_SUPABASE_STORAGE_BUCKET || 'attachments';

export const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

export function withServiceKey(serviceKey) {
  return createClient(SUPABASE_URL, serviceKey);
}

let cachedProfileId = null;
async function getCurrentProfileId() {
  if (cachedProfileId) return cachedProfileId;
  const { data: sessionData, error: sessionError } = await supabase.auth.getSession();
  if (sessionError) throw sessionError;
  const user = sessionData?.session?.user;
  if (!user) return null;
  const { data, error } = await supabase.from('profiles').select('id').eq('auth_uid', user.id).limit(1).single();
  if (error) throw error;
  cachedProfileId = data?.id || null;
  return cachedProfileId;
}

const ownerAwareTables = new Set([
  'conversations',
  'sendpulse_accounts',
  'bitrix24_accounts',
  'bitrix24_open_channels',
  'sendpulse_bots',
  'templates',
  'attachments',
]);

function normalizeOrderField(field) {
  if (!field) return null;
  return field === 'created_date' ? 'created_at'
    : field === 'updated_date' ? 'updated_at'
    : field;
}

function parseOrder(order) {
  if (!order) return null;
  const desc = order.startsWith('-');
  const field = normalizeOrderField(desc ? order.slice(1) : order);
  return { field, ascending: !desc };
}

function buildQuery(table, filters = {}, orderBy, limit) {
  let query = supabase.from(table).select('*');
  Object.entries(filters).forEach(([key, value]) => {
    if (value === null) {
      query = query.is(key, null);
    } else {
      query = query.eq(key, value);
    }
  });
  const order = parseOrder(orderBy);
  if (order && order.field) {
    query = query.order(order.field, { ascending: order.ascending });
  }
  if (limit) {
    query = query.limit(limit);
  }
  return query;
}

function createEntity(tableName) {
  return {
    async list(orderBy, limit) {
      const { data, error } = await buildQuery(tableName, {}, orderBy, limit);
      if (error) throw error;
      return data || [];
    },
    async filter(filters, orderBy, limit) {
      const { data, error } = await buildQuery(tableName, filters, orderBy, limit);
      if (error) throw error;
      return data || [];
    },
    async create(values) {
      const payload = { ...values };
      if (ownerAwareTables.has(tableName) && !payload.owner_id) {
        const profileId = await getCurrentProfileId();
        if (profileId) payload.owner_id = profileId;
      }
      const { data, error } = await supabase.from(tableName).insert([payload]).select().limit(1).single();
      if (error) throw error;
      return data;
    },
    async update(id, values) {
      const { data, error } = await supabase.from(tableName).update(values).eq('id', id).select().limit(1).single();
      if (error) throw error;
      return data;
    },
    async delete(id) {
      const { data, error } = await supabase.from(tableName).delete().eq('id', id);
      if (error) throw error;
      return data;
    }
  };
}

const entityTableMap = {
  Conversation: 'conversations',
  Message: 'messages',
  Bitrix24OpenChannel: 'bitrix24_open_channels',
  Bitrix24Account: 'bitrix24_accounts',
  SendPulseAccount: 'sendpulse_accounts',
  SendPulseBot: 'sendpulse_bots',
  GlobalConfig: 'global_config',
  AppConfig: 'app_config',
};

export const base44 = {
  auth: {
    async me() {
      const { data, error } = await supabase.auth.getUser();
      if (error) throw error;
      return data.user;
    },
    async logout(redirectUrl) {
      await supabase.auth.signOut();
      if (redirectUrl) {
        window.location.href = redirectUrl;
      }
    },
    redirectToLogin(redirectUrl) {
      window.location.href = '/login';
    },
    async loginViaEmailPassword(email, password) {
      const { data, error } = await supabase.auth.signInWithPassword({ email, password });
      if (error) throw error;
      return data.user;
    },
    async loginWithProvider(provider, redirectTo = '/') {
      const { error } = await supabase.auth.signInWithOAuth({ provider, options: { redirectTo } });
      if (error) throw error;
    },
    async register({ email, password }) {
      const { data, error } = await supabase.auth.signUp({ email, password });
      if (error) throw error;
      return data.user;
    },
    async resetPasswordRequest(email) {
      const { data, error } = await supabase.auth.resetPasswordForEmail(email, {
        redirectTo: window.location.origin + '/reset-password',
      });
      if (error) throw error;
      return data;
    },
    async resetPassword({ accessToken, newPassword }) {
      if (!newPassword) throw new Error('New password is required');
      const { data: session, error: sessionError } = await supabase.auth.getSession();
      if (sessionError) throw sessionError;
      if (!session?.session) {
        throw new Error('Unable to reset password without an active session. Use the email link to continue.');
      }
      const { error } = await supabase.auth.updateUser({ password: newPassword });
      if (error) throw error;
      return true;
    }
  },
  functions: {
    async invoke(functionName, payload = {}) {
      const options = {
        body: JSON.stringify(payload),
        headers: { 'Content-Type': 'application/json' },
      };
      const { data, error } = await supabase.functions.invoke(functionName, options);
      if (error) throw error;
      // Wrap response to maintain compatibility with frontend expectations
      return { data: data || {} };
    },
  },
  entities: Object.fromEntries(
    Object.entries(entityTableMap).map(([entity, table]) => [entity, createEntity(table)])
  ),
  storage: {
    async uploadAttachment(file, opts = {}) {
      const path = opts.path || `${Date.now()}_${file.name}`;
      const { data, error } = await supabase.storage.from(STORAGE_BUCKET).upload(path, file);
      if (error) throw error;
      return data;
    },
    getPublicUrl(path) {
      return supabase.storage.from(STORAGE_BUCKET).getPublicUrl(path).data?.publicUrl || null;
    },
  },
};

export default supabase;
