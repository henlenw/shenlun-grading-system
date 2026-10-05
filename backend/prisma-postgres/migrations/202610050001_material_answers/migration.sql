-- Backfill only when adding a column; retries preserve edited drafts and image order.
DO $migration$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = current_schema() AND table_name = 'SubmissionAttempt' AND column_name = 'answerType') THEN
    ALTER TABLE "SubmissionAttempt" ADD COLUMN "answerType" TEXT NOT NULL DEFAULT 'text';
    UPDATE "SubmissionAttempt" SET "answerType" = CASE
      WHEN EXISTS (SELECT 1 FROM "Attachment" WHERE "attemptId" = "SubmissionAttempt"."id")
        THEN CASE WHEN trim("text") <> '' THEN 'mixed' ELSE 'image' END
      ELSE 'text' END;
  END IF;
  ALTER TABLE "SubmissionAttempt" ADD COLUMN IF NOT EXISTS "studentAnnotations" TEXT NOT NULL DEFAULT '[]';
  ALTER TABLE "SubmissionAttempt" ADD COLUMN IF NOT EXISTS "annotationsVersion" INTEGER NOT NULL DEFAULT 0;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = current_schema() AND table_name = 'Attachment' AND column_name = 'position') THEN
    ALTER TABLE "Attachment" ADD COLUMN "position" INTEGER NOT NULL DEFAULT 0;
    UPDATE "Attachment" SET "position" = ordered.position FROM
      (SELECT id, (row_number() OVER (PARTITION BY "attemptId" ORDER BY "createdAt", id) - 1)::integer AS position FROM "Attachment") AS ordered
      WHERE "Attachment".id = ordered.id;
  END IF;
END
$migration$;
