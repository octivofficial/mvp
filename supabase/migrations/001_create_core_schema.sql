-- ============================================================
-- Octiv MVP — Core Schema  (001)
-- Redis  = 실시간 (좌표, HP, 현재 태스크)
-- Supabase = 영속 (히스토리, 스킬, 메트릭, 분석)
-- ============================================================

-- 1. agents — 에이전트 레지스트리
CREATE TABLE public.agents (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name        text NOT NULL UNIQUE,
  role        text NOT NULL CHECK (role IN (
                'leader','builder','miner','farmer',
                'explorer','safety','crawler','octivia'
              )),
  config      jsonb NOT NULL DEFAULT '{}',
  is_active   boolean NOT NULL DEFAULT true,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE public.agents IS '에이전트 레지스트리 — Redis의 실시간 상태를 보완하는 영속 설정';

-- 2. missions — 미션 이력
CREATE TABLE public.missions (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  code          text NOT NULL,
  name          text NOT NULL,
  type          text NOT NULL CHECK (type IN (
                  'gathering','building','exploration',
                  'combat','farming','mining','compound'
                )),
  status        text NOT NULL DEFAULT 'pending' CHECK (status IN (
                  'pending','in_progress','completed','failed','cancelled'
                )),
  target        jsonb NOT NULL DEFAULT '{}',
  outcome       jsonb,
  started_at    timestamptz,
  completed_at  timestamptz,
  created_at    timestamptz NOT NULL DEFAULT now()
);

-- 3. mission_assignments — 미션 ↔ 에이전트 (다대다)
CREATE TABLE public.mission_assignments (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  mission_id  uuid NOT NULL REFERENCES public.missions(id) ON DELETE CASCADE,
  agent_id    uuid NOT NULL REFERENCES public.agents(id) ON DELETE CASCADE,
  role        text NOT NULL DEFAULT 'worker',
  assigned_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(mission_id, agent_id)
);

-- 4. skills — 학습된 스킬 (Zettelkasten)
CREATE TABLE public.skills (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name            text NOT NULL UNIQUE,
  skill_type      text NOT NULL CHECK (skill_type IN ('atomic','compound')),
  category        text NOT NULL,
  description     text NOT NULL,
  source_agent    text,
  source_mission  text,
  prerequisites   text[] DEFAULT '{}',
  code_snippet    text,
  success_count   int NOT NULL DEFAULT 0,
  fail_count      int NOT NULL DEFAULT 0,
  metadata        jsonb NOT NULL DEFAULT '{}',
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now()
);

-- 5. reflexions — ReflexionEngine 결과
CREATE TABLE public.reflexions (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  agent_id        uuid REFERENCES public.agents(id) ON DELETE SET NULL,
  mission_id      uuid REFERENCES public.missions(id) ON DELETE SET NULL,
  experience      text NOT NULL,
  reflection      text NOT NULL,
  skill_extracted text,
  model_used      text,
  tokens_used     int,
  created_at      timestamptz NOT NULL DEFAULT now()
);

-- 6. events — 영속 이벤트 로그
CREATE TABLE public.events (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  agent_name  text NOT NULL,
  event_type  text NOT NULL,
  severity    text NOT NULL DEFAULT 'info' CHECK (severity IN (
                'debug','info','warn','error','critical'
              )),
  data        jsonb NOT NULL DEFAULT '{}',
  created_at  timestamptz NOT NULL DEFAULT now()
);

-- 7. metrics — 시계열 성능 메트릭
CREATE TABLE public.metrics (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  agent_name  text NOT NULL,
  metric_type text NOT NULL,
  value       numeric NOT NULL,
  unit        text DEFAULT 'count',
  tags        jsonb NOT NULL DEFAULT '{}',
  recorded_at timestamptz NOT NULL DEFAULT now()
);

-- 8. got_traces — Graph-of-Thought 추론 기록
CREATE TABLE public.got_traces (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  cycle_number  int NOT NULL,
  input_skills  text[] NOT NULL DEFAULT '{}',
  reasoning     text NOT NULL,
  synergies     jsonb NOT NULL DEFAULT '[]',
  model_used    text,
  created_at    timestamptz NOT NULL DEFAULT now()
);

-- ============================================================
-- INDEXES
-- ============================================================

CREATE INDEX idx_events_created_at ON public.events (created_at DESC);
CREATE INDEX idx_events_agent_type ON public.events (agent_name, event_type);
CREATE INDEX idx_metrics_recorded_at ON public.metrics (recorded_at DESC);
CREATE INDEX idx_metrics_agent_type ON public.metrics (agent_name, metric_type);
CREATE INDEX idx_missions_status ON public.missions (status);
CREATE INDEX idx_missions_code ON public.missions (code);
CREATE INDEX idx_skills_category ON public.skills (category);
CREATE INDEX idx_skills_type ON public.skills (skill_type);
CREATE INDEX idx_reflexions_created_at ON public.reflexions (created_at DESC);
CREATE INDEX idx_got_traces_cycle ON public.got_traces (cycle_number DESC);

-- ============================================================
-- UPDATED_AT TRIGGER
-- ============================================================

CREATE OR REPLACE FUNCTION public.handle_updated_at()
RETURNS trigger AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER set_agents_updated_at
  BEFORE UPDATE ON public.agents
  FOR EACH ROW EXECUTE FUNCTION public.handle_updated_at();

CREATE TRIGGER set_skills_updated_at
  BEFORE UPDATE ON public.skills
  FOR EACH ROW EXECUTE FUNCTION public.handle_updated_at();

-- ============================================================
-- RLS (Row Level Security)
-- ============================================================

ALTER TABLE public.agents ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.missions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.mission_assignments ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.skills ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.reflexions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.events ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.metrics ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.got_traces ENABLE ROW LEVEL SECURITY;

-- anon/authenticated: SELECT only (대시보드 읽기용)
-- service_role: RLS bypass (서버 사이드 쓰기용)
CREATE POLICY "read_all" ON public.agents FOR SELECT USING (true);
CREATE POLICY "read_all" ON public.missions FOR SELECT USING (true);
CREATE POLICY "read_all" ON public.mission_assignments FOR SELECT USING (true);
CREATE POLICY "read_all" ON public.skills FOR SELECT USING (true);
CREATE POLICY "read_all" ON public.reflexions FOR SELECT USING (true);
CREATE POLICY "read_all" ON public.events FOR SELECT USING (true);
CREATE POLICY "read_all" ON public.metrics FOR SELECT USING (true);
CREATE POLICY "read_all" ON public.got_traces FOR SELECT USING (true);
