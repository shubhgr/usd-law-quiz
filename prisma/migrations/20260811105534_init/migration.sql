-- CreateTable
CREATE TABLE "Registration" (
    "pid" TEXT NOT NULL PRIMARY KEY,
    "name" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "phone" TEXT NOT NULL,
    "registeredAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "status" TEXT NOT NULL DEFAULT 'not_started',
    "lastActivityAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- CreateTable
CREATE TABLE "Response" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "pid" TEXT NOT NULL,
    "questionId" TEXT NOT NULL,
    "answer" TEXT NOT NULL,
    "isCorrect" BOOLEAN NOT NULL,
    "answeredAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "Response_pid_fkey" FOREIGN KEY ("pid") REFERENCES "Registration" ("pid") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "Score" (
    "pid" TEXT NOT NULL PRIMARY KEY,
    "totalScore" INTEGER NOT NULL,
    "completionTimeSeconds" INTEGER NOT NULL,
    "completedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "Score_pid_fkey" FOREIGN KEY ("pid") REFERENCES "Registration" ("pid") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateIndex
CREATE UNIQUE INDEX "Registration_email_key" ON "Registration"("email");

-- CreateIndex
CREATE INDEX "Response_pid_idx" ON "Response"("pid");

-- CreateIndex
CREATE UNIQUE INDEX "Response_pid_questionId_key" ON "Response"("pid", "questionId");
