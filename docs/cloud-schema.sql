-- Backtest only. Additive schema; never DROP or TRUNCATE.
BEGIN;


CREATE TABLE IF NOT EXISTS replay_datasets (
	owner_id VARCHAR(36) DEFAULT 'local' NOT NULL,
	id VARCHAR(36) NOT NULL,
	name VARCHAR(150) NOT NULL,
	symbol VARCHAR(40) NOT NULL,
	timeframe VARCHAR(8) NOT NULL,
	source VARCHAR(80) NOT NULL,
	synthetic BOOLEAN NOT NULL,
	bars JSON NOT NULL,
	metadata_json JSON NOT NULL,
	created_at TIMESTAMP WITH TIME ZONE NOT NULL,
	PRIMARY KEY (id)
)

;

ALTER TABLE replay_datasets ADD COLUMN IF NOT EXISTS owner_id VARCHAR(36) NOT NULL DEFAULT 'local';

CREATE INDEX IF NOT EXISTS ix_replay_datasets_owner_id ON replay_datasets (owner_id);

ALTER TABLE replay_datasets ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE replay_datasets FROM anon;

GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE replay_datasets TO authenticated;

DO $$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='replay_datasets' AND policyname='replay_datasets_owner_select') THEN CREATE POLICY replay_datasets_owner_select ON replay_datasets FOR SELECT TO authenticated USING (COALESCE((nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'tq_backtest') = 'true', false) AND (owner_id = (SELECT auth.uid())::text OR owner_id = 'shared')); END IF; END $$;

DO $$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='replay_datasets' AND policyname='replay_datasets_owner_insert') THEN CREATE POLICY replay_datasets_owner_insert ON replay_datasets FOR INSERT TO authenticated WITH CHECK (COALESCE((nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'tq_backtest') = 'true', false) AND owner_id = (SELECT auth.uid())::text); END IF; END $$;

DO $$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='replay_datasets' AND policyname='replay_datasets_owner_update') THEN CREATE POLICY replay_datasets_owner_update ON replay_datasets FOR UPDATE TO authenticated USING (COALESCE((nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'tq_backtest') = 'true', false) AND owner_id = (SELECT auth.uid())::text) WITH CHECK (COALESCE((nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'tq_backtest') = 'true', false) AND owner_id = (SELECT auth.uid())::text); END IF; END $$;

DO $$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='replay_datasets' AND policyname='replay_datasets_owner_delete') THEN CREATE POLICY replay_datasets_owner_delete ON replay_datasets FOR DELETE TO authenticated USING (COALESCE((nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'tq_backtest') = 'true', false) AND owner_id = (SELECT auth.uid())::text); END IF; END $$;


CREATE TABLE IF NOT EXISTS settings (
	owner_id VARCHAR(36) DEFAULT 'local' NOT NULL,
	key VARCHAR(100) NOT NULL,
	value JSON NOT NULL,
	PRIMARY KEY (key)
)

;

ALTER TABLE settings ADD COLUMN IF NOT EXISTS owner_id VARCHAR(36) NOT NULL DEFAULT 'local';

CREATE INDEX IF NOT EXISTS ix_settings_owner_id ON settings (owner_id);

ALTER TABLE settings ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE settings FROM anon;

GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE settings TO authenticated;

DO $$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='settings' AND policyname='settings_owner_select') THEN CREATE POLICY settings_owner_select ON settings FOR SELECT TO authenticated USING (COALESCE((nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'tq_backtest') = 'true', false) AND (owner_id = (SELECT auth.uid())::text)); END IF; END $$;

DO $$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='settings' AND policyname='settings_owner_insert') THEN CREATE POLICY settings_owner_insert ON settings FOR INSERT TO authenticated WITH CHECK (COALESCE((nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'tq_backtest') = 'true', false) AND owner_id = (SELECT auth.uid())::text); END IF; END $$;

DO $$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='settings' AND policyname='settings_owner_update') THEN CREATE POLICY settings_owner_update ON settings FOR UPDATE TO authenticated USING (COALESCE((nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'tq_backtest') = 'true', false) AND owner_id = (SELECT auth.uid())::text) WITH CHECK (COALESCE((nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'tq_backtest') = 'true', false) AND owner_id = (SELECT auth.uid())::text); END IF; END $$;

DO $$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='settings' AND policyname='settings_owner_delete') THEN CREATE POLICY settings_owner_delete ON settings FOR DELETE TO authenticated USING (COALESCE((nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'tq_backtest') = 'true', false) AND owner_id = (SELECT auth.uid())::text); END IF; END $$;


CREATE TABLE IF NOT EXISTS replay_sessions (
	owner_id VARCHAR(36) DEFAULT 'local' NOT NULL,
	id VARCHAR(36) NOT NULL,
	dataset_id VARCHAR(36) NOT NULL,
	name VARCHAR(150) NOT NULL,
	cursor INTEGER NOT NULL,
	end_cursor INTEGER NOT NULL,
	revision INTEGER NOT NULL,
	status VARCHAR(16) NOT NULL,
	config_json JSON NOT NULL,
	drawings JSON NOT NULL,
	indicators JSON NOT NULL,
	created_at TIMESTAMP WITH TIME ZONE NOT NULL,
	updated_at TIMESTAMP WITH TIME ZONE NOT NULL,
	PRIMARY KEY (id),
	FOREIGN KEY(dataset_id) REFERENCES replay_datasets (id)
)

;

ALTER TABLE replay_sessions ADD COLUMN IF NOT EXISTS owner_id VARCHAR(36) NOT NULL DEFAULT 'local';

CREATE INDEX IF NOT EXISTS ix_replay_sessions_owner_id ON replay_sessions (owner_id);

ALTER TABLE replay_sessions ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE replay_sessions FROM anon;

GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE replay_sessions TO authenticated;

DO $$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='replay_sessions' AND policyname='replay_sessions_owner_select') THEN CREATE POLICY replay_sessions_owner_select ON replay_sessions FOR SELECT TO authenticated USING (COALESCE((nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'tq_backtest') = 'true', false) AND (owner_id = (SELECT auth.uid())::text)); END IF; END $$;

DO $$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='replay_sessions' AND policyname='replay_sessions_owner_insert') THEN CREATE POLICY replay_sessions_owner_insert ON replay_sessions FOR INSERT TO authenticated WITH CHECK (COALESCE((nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'tq_backtest') = 'true', false) AND owner_id = (SELECT auth.uid())::text AND EXISTS (SELECT 1 FROM replay_datasets d WHERE d.id = dataset_id)); END IF; END $$;

DO $$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='replay_sessions' AND policyname='replay_sessions_owner_update') THEN CREATE POLICY replay_sessions_owner_update ON replay_sessions FOR UPDATE TO authenticated USING (COALESCE((nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'tq_backtest') = 'true', false) AND owner_id = (SELECT auth.uid())::text) WITH CHECK (COALESCE((nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'tq_backtest') = 'true', false) AND owner_id = (SELECT auth.uid())::text AND EXISTS (SELECT 1 FROM replay_datasets d WHERE d.id = dataset_id)); END IF; END $$;

DO $$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='replay_sessions' AND policyname='replay_sessions_owner_delete') THEN CREATE POLICY replay_sessions_owner_delete ON replay_sessions FOR DELETE TO authenticated USING (COALESCE((nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'tq_backtest') = 'true', false) AND owner_id = (SELECT auth.uid())::text); END IF; END $$;


CREATE TABLE IF NOT EXISTS replay_trades (
	owner_id VARCHAR(36) DEFAULT 'local' NOT NULL,
	id VARCHAR(36) NOT NULL,
	session_id VARCHAR(36) NOT NULL,
	status VARCHAR(16) NOT NULL,
	side VARCHAR(4) NOT NULL,
	order_type VARCHAR(8) NOT NULL,
	requested_entry FLOAT,
	entry_price FLOAT,
	stop_price FLOAT NOT NULL,
	target_price FLOAT NOT NULL,
	entry_time INTEGER,
	exit_time INTEGER,
	exit_price FLOAT,
	net_r FLOAT,
	exit_reason VARCHAR(100),
	ambiguous BOOLEAN NOT NULL,
	playbook_snapshot JSON NOT NULL,
	decision JSON NOT NULL,
	review JSON,
	created_at TIMESTAMP WITH TIME ZONE NOT NULL,
	PRIMARY KEY (id),
	FOREIGN KEY(session_id) REFERENCES replay_sessions (id)
)

;

ALTER TABLE replay_trades ADD COLUMN IF NOT EXISTS owner_id VARCHAR(36) NOT NULL DEFAULT 'local';

CREATE INDEX IF NOT EXISTS ix_replay_trades_owner_id ON replay_trades (owner_id);

CREATE INDEX IF NOT EXISTS ix_replay_trades_session_id ON replay_trades (session_id);

ALTER TABLE replay_trades ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE replay_trades FROM anon;

GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE replay_trades TO authenticated;

DO $$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='replay_trades' AND policyname='replay_trades_owner_select') THEN CREATE POLICY replay_trades_owner_select ON replay_trades FOR SELECT TO authenticated USING (COALESCE((nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'tq_backtest') = 'true', false) AND (owner_id = (SELECT auth.uid())::text)); END IF; END $$;

DO $$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='replay_trades' AND policyname='replay_trades_owner_insert') THEN CREATE POLICY replay_trades_owner_insert ON replay_trades FOR INSERT TO authenticated WITH CHECK (COALESCE((nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'tq_backtest') = 'true', false) AND owner_id = (SELECT auth.uid())::text AND EXISTS (SELECT 1 FROM replay_sessions s WHERE s.id = session_id)); END IF; END $$;

DO $$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='replay_trades' AND policyname='replay_trades_owner_update') THEN CREATE POLICY replay_trades_owner_update ON replay_trades FOR UPDATE TO authenticated USING (COALESCE((nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'tq_backtest') = 'true', false) AND owner_id = (SELECT auth.uid())::text) WITH CHECK (COALESCE((nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'tq_backtest') = 'true', false) AND owner_id = (SELECT auth.uid())::text AND EXISTS (SELECT 1 FROM replay_sessions s WHERE s.id = session_id)); END IF; END $$;

DO $$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='replay_trades' AND policyname='replay_trades_owner_delete') THEN CREATE POLICY replay_trades_owner_delete ON replay_trades FOR DELETE TO authenticated USING (COALESCE((nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'tq_backtest') = 'true', false) AND owner_id = (SELECT auth.uid())::text); END IF; END $$;

COMMIT;
