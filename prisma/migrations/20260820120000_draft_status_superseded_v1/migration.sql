-- Additive: a new enum member only. The value is NOT used in this migration, because
-- Postgres forbids using a newly added enum value in the same transaction that adds it,
-- and prisma migrate deploy runs each migration in one. Backfilling the existing rows is
-- a separate, deliberate operation.
ALTER TYPE "TechDraftStatus" ADD VALUE IF NOT EXISTS 'SUPERSEDED_V1';
