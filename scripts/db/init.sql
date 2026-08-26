-- USD Knowledge Challenge (Postgres) schema
-- Run this against your Neon database.

-- Participants table (registration + status)
CREATE TABLE IF NOT EXISTS participants (
  pid uuid PRIMARY KEY,
  name text NOT NULL,
  email text NOT NULL UNIQUE,
  phone text NOT NULL DEFAULT '',
  work_experience text NOT NULL DEFAULT '',
  domain text NOT NULL DEFAULT '',
  linkedin_url text NULL,
  best_describe_you text NULL,
  consider_masters text NULL,
  planning_year text NULL,
  interests_most text NULL,
  college_name text NULL,
  tab_switches integer NOT NULL DEFAULT 0,
  status text NOT NULL CHECK (status IN ('not_started', 'in_progress', 'completed')),
  registered_at timestamptz NOT NULL,
  last_activity_at timestamptz NOT NULL
);

-- If the participants table already exists, add missing columns for
-- lead-gen fields without requiring a destructive migration.
ALTER TABLE participants ADD COLUMN IF NOT EXISTS linkedin_url text NULL;
ALTER TABLE participants ADD COLUMN IF NOT EXISTS best_describe_you text NULL;
ALTER TABLE participants ADD COLUMN IF NOT EXISTS consider_masters text NULL;
ALTER TABLE participants ADD COLUMN IF NOT EXISTS planning_year text NULL;
ALTER TABLE participants ADD COLUMN IF NOT EXISTS college_name text NULL;
ALTER TABLE participants ALTER COLUMN college_name DROP NOT NULL;

-- Admin-managed colleges (custom names beyond the CSV catalog)
CREATE TABLE IF NOT EXISTS colleges (
  id bigserial PRIMARY KEY,
  name text NOT NULL UNIQUE,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS colleges_name_lower_idx ON colleges (lower(name));


ALTER TABLE participants ADD COLUMN IF NOT EXISTS tab_switches integer NOT NULL DEFAULT 0;
ALTER TABLE participants ADD COLUMN IF NOT EXISTS quiz_started_at timestamptz NULL;

-- Attempts table (answers + computed score/time)
CREATE TABLE IF NOT EXISTS attempts (
  pid uuid PRIMARY KEY REFERENCES participants(pid) ON DELETE CASCADE,
  answers text NOT NULL DEFAULT '',
  score integer NULL,
  completion_time_seconds integer NULL,
  completed_at timestamptz NULL,
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- Leaderboard ordering:
-- 1) higher score
-- 2) lower completion_time_seconds
-- 3) earlier completed_at
-- Indexes to keep leaderboard fast.
CREATE INDEX IF NOT EXISTS participants_email_idx ON participants(email);
CREATE INDEX IF NOT EXISTS attempts_completed_at_idx ON attempts(completed_at);
CREATE INDEX IF NOT EXISTS attempts_score_idx ON attempts(score);
CREATE INDEX IF NOT EXISTS attempts_completion_time_idx ON attempts(completion_time_seconds);

-- Prevent duplicate “completed” ranks for the same ordering values.
-- (Row-numbering is deterministic at query time, but this helps keep data tidy.)
CREATE INDEX IF NOT EXISTS attempts_leaderboard_idx
  ON attempts(score DESC NULLS LAST, completion_time_seconds ASC NULLS LAST, completed_at ASC NULLS LAST);

