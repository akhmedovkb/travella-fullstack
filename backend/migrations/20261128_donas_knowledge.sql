-- Additive only: no operational tables, triggers, recipe or finance changes.
CREATE TABLE IF NOT EXISTS donas_knowledge_documents (
  id BIGSERIAL PRIMARY KEY,
  slug TEXT NOT NULL CHECK (slug = 'donas-dosas'),
  kind TEXT NOT NULL CHECK (kind IN ('business-concept', 'product-bible')),
  current_revision INTEGER NOT NULL DEFAULT 0 CHECK (current_revision >= 0),
  UNIQUE (slug, kind)
);
CREATE TABLE IF NOT EXISTS donas_knowledge_versions (
  document_id BIGINT NOT NULL REFERENCES donas_knowledge_documents(id),
  revision INTEGER NOT NULL CHECK (revision > 0),
  edition TEXT NOT NULL,
  title TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('draft', 'rd', 'approved')),
  sections JSONB NOT NULL CHECK (jsonb_typeof(sections) = 'array'),
  change_note TEXT NOT NULL,
  actor_id TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (document_id, revision)
);
-- The application only appends versions. Enforce immutable history in PostgreSQL too.
CREATE OR REPLACE FUNCTION donas_knowledge_immutable_version() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'Knowledge versions are immutable';
END;
$$ LANGUAGE plpgsql;
DROP TRIGGER IF EXISTS donas_knowledge_no_rewrite ON donas_knowledge_versions;
CREATE TRIGGER donas_knowledge_no_rewrite BEFORE UPDATE OR DELETE ON donas_knowledge_versions
FOR EACH ROW EXECUTE FUNCTION donas_knowledge_immutable_version();
