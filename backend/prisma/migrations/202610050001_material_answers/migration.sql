ALTER TABLE "SubmissionAttempt" ADD COLUMN "answerType" TEXT NOT NULL DEFAULT 'text';
ALTER TABLE "SubmissionAttempt" ADD COLUMN "studentAnnotations" TEXT NOT NULL DEFAULT '[]';
ALTER TABLE "SubmissionAttempt" ADD COLUMN "annotationsVersion" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "Attachment" ADD COLUMN "position" INTEGER NOT NULL DEFAULT 0;
UPDATE "SubmissionAttempt" SET "answerType" = CASE
  WHEN EXISTS (SELECT 1 FROM "Attachment" WHERE "attemptId" = "SubmissionAttempt"."id")
    THEN CASE WHEN trim("text") <> '' THEN 'mixed' ELSE 'image' END
  ELSE 'text' END;
UPDATE "Attachment" SET "position" = (SELECT count(*) FROM "Attachment" AS other
  WHERE other."attemptId" = "Attachment"."attemptId" AND
  (other."createdAt" < "Attachment"."createdAt" OR (other."createdAt" = "Attachment"."createdAt" AND other."id" < "Attachment"."id")));
