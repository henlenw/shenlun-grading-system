-- Additive migration. Legacy attempts are ranked across assignments; none are removed.
ALTER TABLE "StudentProfile" ADD COLUMN "serviceType" TEXT NOT NULL DEFAULT '';
ALTER TABLE "StudentProfile" ADD COLUMN "notes" TEXT NOT NULL DEFAULT '';
ALTER TABLE "Question" ADD COLUMN "category" TEXT NOT NULL DEFAULT '专项训练';
ALTER TABLE "Question" ADD COLUMN "teacherInstructions" TEXT NOT NULL DEFAULT '';
ALTER TABLE "Question" ADD COLUMN "aiInstructions" TEXT NOT NULL DEFAULT '';
ALTER TABLE "Question" ADD COLUMN "allowReference" BOOLEAN NOT NULL DEFAULT true;
ALTER TABLE "Question" ADD COLUMN "autoUnlockReference" BOOLEAN NOT NULL DEFAULT true;
ALTER TABLE "SubmissionAttempt" ADD COLUMN "studentId" TEXT NOT NULL DEFAULT '';
ALTER TABLE "SubmissionAttempt" ADD COLUMN "questionId" TEXT NOT NULL DEFAULT '';
ALTER TABLE "SubmissionAttempt" ADD COLUMN "roundNo" INTEGER NOT NULL DEFAULT 1;
ALTER TABLE "SubmissionAttempt" ADD COLUMN "questionSnapshot" TEXT NOT NULL DEFAULT '';
UPDATE "SubmissionAttempt" SET
 "studentId"=(SELECT "studentId" FROM "Submission" WHERE "id"="SubmissionAttempt"."submissionId"),
 "questionId"=(SELECT a."questionId" FROM "Submission" s JOIN "Assignment" a ON a."id"=s."assignmentId" WHERE s."id"="SubmissionAttempt"."submissionId"),
 "questionSnapshot"=(SELECT a."questionSnapshot" FROM "Submission" s JOIN "Assignment" a ON a."id"=s."assignmentId" WHERE s."id"="SubmissionAttempt"."submissionId");
WITH ranked AS (SELECT "id", ROW_NUMBER() OVER(PARTITION BY "studentId","questionId" ORDER BY "createdAt","id") AS n FROM "SubmissionAttempt")
UPDATE "SubmissionAttempt" SET "roundNo"=(SELECT n FROM ranked WHERE ranked."id"="SubmissionAttempt"."id");
CREATE UNIQUE INDEX "SubmissionAttempt_studentId_questionId_roundNo_key" ON "SubmissionAttempt"("studentId","questionId","roundNo");
DROP INDEX "Attachment_filePath_key";
CREATE INDEX "Attachment_checksum_idx" ON "Attachment"("checksum");
ALTER TABLE "TeacherReview" ADD COLUMN "pageAnnotations" TEXT NOT NULL DEFAULT '[]';
CREATE TABLE "ScoringPoint" ("id" TEXT NOT NULL PRIMARY KEY,"questionId" TEXT NOT NULL,"label" TEXT NOT NULL,"description" TEXT NOT NULL DEFAULT '',"points" REAL NOT NULL,"position" INTEGER NOT NULL,FOREIGN KEY("questionId") REFERENCES "Question"("id") ON DELETE CASCADE ON UPDATE CASCADE);
CREATE TABLE "Permission" ("id" TEXT NOT NULL PRIMARY KEY,"studentId" TEXT NOT NULL,"questionId" TEXT NOT NULL,"teacherId" TEXT NOT NULL,"source" TEXT NOT NULL DEFAULT 'MANUAL',"revokedAt" DATETIME,"referenceUnlocked" BOOLEAN NOT NULL DEFAULT false,"createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,"updatedAt" DATETIME NOT NULL);
CREATE UNIQUE INDEX "Permission_studentId_questionId_key" ON "Permission"("studentId","questionId");
CREATE INDEX "Permission_teacherId_idx" ON "Permission"("teacherId");
INSERT INTO "Permission"("id","studentId","questionId","teacherId","source","updatedAt")
 SELECT 'legacy-' || MIN(r."id"),r."studentId",a."questionId",q."teacherId",'LEGACY_ASSIGNMENT',CURRENT_TIMESTAMP
 FROM "AssignmentRecipient" r JOIN "Assignment" a ON a."id"=r."assignmentId" JOIN "Question" q ON q."id"=a."questionId"
 GROUP BY r."studentId",a."questionId";
CREATE TABLE "PermissionPackage" ("id" TEXT NOT NULL PRIMARY KEY,"teacherId" TEXT NOT NULL,"name" TEXT NOT NULL,"description" TEXT NOT NULL DEFAULT '',"questionIds" TEXT NOT NULL DEFAULT '[]',"courseIds" TEXT NOT NULL DEFAULT '[]',"createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,"updatedAt" DATETIME NOT NULL);
CREATE TABLE "RedemptionCode" ("id" TEXT NOT NULL PRIMARY KEY,"teacherId" TEXT NOT NULL,"packageId" TEXT NOT NULL,"label" TEXT NOT NULL,"codeHash" TEXT NOT NULL,"maxUses" INTEGER NOT NULL DEFAULT 1,"uses" INTEGER NOT NULL DEFAULT 0,"bindFirstUser" BOOLEAN NOT NULL DEFAULT true,"boundStudentId" TEXT,"expiresAt" DATETIME NOT NULL,"disabled" BOOLEAN NOT NULL DEFAULT false,"createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP);
CREATE UNIQUE INDEX "RedemptionCode_codeHash_key" ON "RedemptionCode"("codeHash");
CREATE TABLE "RedemptionUse" ("id" TEXT NOT NULL PRIMARY KEY,"codeId" TEXT NOT NULL,"studentId" TEXT NOT NULL,"createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,FOREIGN KEY("codeId") REFERENCES "RedemptionCode"("id") ON DELETE RESTRICT ON UPDATE CASCADE);
CREATE UNIQUE INDEX "RedemptionUse_codeId_studentId_key" ON "RedemptionUse"("codeId","studentId");
CREATE TABLE "Course" ("id" TEXT NOT NULL PRIMARY KEY,"teacherId" TEXT NOT NULL,"name" TEXT NOT NULL,"description" TEXT NOT NULL DEFAULT '',"createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP);
CREATE TABLE "CoursePermission" ("id" TEXT NOT NULL PRIMARY KEY,"courseId" TEXT NOT NULL,"studentId" TEXT NOT NULL,"teacherId" TEXT NOT NULL,"source" TEXT NOT NULL DEFAULT 'MANUAL',"note" TEXT NOT NULL DEFAULT '',"revokedAt" DATETIME,"createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,"updatedAt" DATETIME NOT NULL,FOREIGN KEY("courseId") REFERENCES "Course"("id") ON DELETE RESTRICT ON UPDATE CASCADE);
CREATE UNIQUE INDEX "CoursePermission_courseId_studentId_key" ON "CoursePermission"("courseId","studentId");
CREATE TABLE "OCRResult" ("id" TEXT NOT NULL PRIMARY KEY,"attemptId" TEXT NOT NULL,"status" TEXT NOT NULL,"text" TEXT NOT NULL DEFAULT '',"error" TEXT NOT NULL DEFAULT '',"createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,FOREIGN KEY("attemptId") REFERENCES "SubmissionAttempt"("id") ON DELETE RESTRICT ON UPDATE CASCADE);
CREATE UNIQUE INDEX "OCRResult_attemptId_key" ON "OCRResult"("attemptId");