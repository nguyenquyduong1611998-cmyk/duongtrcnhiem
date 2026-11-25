-- PHASE 5 / PREVIEW ONLY / PREPARED SEED. DO NOT EXECUTE YET.
-- Need independent verified backup of D1 'duongtrcnhiem-auth-preview' first.
-- Never run on canonical staging, production Pages, Firebase or real content DB.
-- Only mathematical synthetic material. No accounts, user data, grades or secrets.
-- No INSERT OR REPLACE, no DELETE, DROP, ALTER or modification to Phase 4.
-- Apply at most ONCE after manual confirmation of D1 binding and migration.
-- A second run intentionally fails rather than overwriting existing content.
-- The matching schema is serverless/d1-phase5-content-model-draft.sql.
INSERT INTO phase5_content_topics (topic_id, created_at)
VALUES ('p5_demo_math', 1800000000);

INSERT INTO phase5_content_versions (
  topic_id, revision, code, title, description,
  time_limit_seconds, state, created_at, published_at
) VALUES (
  'p5_demo_math', 1, 'P5-DEMO', 'Toán học DEMO',
  'Câu hỏi hoàn toàn giả để thử đồng bộ, không phải đề thi thực tế.',
  600, 'draft', 1800000000, NULL
);

INSERT INTO phase5_content_questions (
  topic_id, revision, question_id, order_index,
  question_text, option_a, option_b, option_c, option_d
) VALUES (
  'p5_demo_math', 1, 'q1', 1, '2 + 2 bằng bao nhiêu?',
  '3', '4', '5', '6'
);

INSERT INTO phase5_content_answer_keys (
  topic_id, revision, question_id, correct_index, explanation
) VALUES (
  'p5_demo_math', 1, 'q1', 1,
  'Đáp án giả phục vụ kiểm thử chấm điểm phía máy chủ.'
);

UPDATE phase5_content_versions
SET state='published', published_at=1800000001
WHERE topic_id='p5_demo_math' AND revision=1 AND state='draft';
