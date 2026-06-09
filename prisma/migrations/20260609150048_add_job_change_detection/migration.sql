/*
  Warnings:

  - The values [PENDING,IGNORED,WITHDRAWN] on the enum `ConnectionRequestStatus` will be removed. If these variants are still used in the database, this will fail.
  - The values [PENDING,DONE] on the enum `ProspectingRunStatus` will be removed. If these variants are still used in the database, this will fail.
  - You are about to drop the column `profileUrl` on the `ConnectionRequest` table. All the data in the column will be lost.
  - You are about to drop the column `respondedAt` on the `ConnectionRequest` table. All the data in the column will be lost.
  - You are about to drop the column `updatedAt` on the `ConnectionRequest` table. All the data in the column will be lost.
  - You are about to drop the column `errorMessage` on the `ProspectingRun` table. All the data in the column will be lost.
  - You are about to drop the column `payload` on the `ProspectingRun` table. All the data in the column will be lost.
  - You are about to drop the column `result` on the `ProspectingRun` table. All the data in the column will be lost.
  - You are about to drop the column `updatedAt` on the `ProspectingRun` table. All the data in the column will be lost.
  - A unique constraint covering the columns `[ownerId,name]` on the table `ContactList` will be added. If there are existing duplicate values, this will fail.
  - Added the required column `linkedinUrl` to the `ConnectionRequest` table without a default value. This is not possible if the table is not empty.
  - Made the column `runId` on table `ConnectionRequest` required. This step will fail if there are existing NULL values in that column.
  - Added the required column `keywords` to the `ProspectingRun` table without a default value. This is not possible if the table is not empty.
  - Added the required column `name` to the `ProspectingRun` table without a default value. This is not possible if the table is not empty.
  - Added the required column `searchUrl` to the `ProspectingRun` table without a default value. This is not possible if the table is not empty.

*/
-- CreateEnum
CREATE TYPE "ImportJobStatus" AS ENUM ('QUEUED', 'PROCESSING', 'DONE', 'ERROR');

-- AlterEnum
BEGIN;
CREATE TYPE "ConnectionRequestStatus_new" AS ENUM ('DISCOVERED', 'QUEUED', 'SENT', 'FAILED', 'SKIPPED', 'ACCEPTED');
ALTER TABLE "public"."ConnectionRequest" ALTER COLUMN "status" DROP DEFAULT;
ALTER TABLE "ConnectionRequest" ALTER COLUMN "status" TYPE "ConnectionRequestStatus_new" USING ("status"::text::"ConnectionRequestStatus_new");
ALTER TYPE "ConnectionRequestStatus" RENAME TO "ConnectionRequestStatus_old";
ALTER TYPE "ConnectionRequestStatus_new" RENAME TO "ConnectionRequestStatus";
DROP TYPE "public"."ConnectionRequestStatus_old";
ALTER TABLE "ConnectionRequest" ALTER COLUMN "status" SET DEFAULT 'DISCOVERED';
COMMIT;

-- AlterEnum
BEGIN;
CREATE TYPE "ProspectingRunStatus_new" AS ENUM ('DRAFT', 'RUNNING', 'PAUSED', 'COMPLETED', 'FAILED');
ALTER TABLE "public"."ProspectingRun" ALTER COLUMN "status" DROP DEFAULT;
ALTER TABLE "ProspectingRun" ALTER COLUMN "status" TYPE "ProspectingRunStatus_new" USING ("status"::text::"ProspectingRunStatus_new");
ALTER TYPE "ProspectingRunStatus" RENAME TO "ProspectingRunStatus_old";
ALTER TYPE "ProspectingRunStatus_new" RENAME TO "ProspectingRunStatus";
DROP TYPE "public"."ProspectingRunStatus_old";
ALTER TABLE "ProspectingRun" ALTER COLUMN "status" SET DEFAULT 'DRAFT';
COMMIT;

-- DropForeignKey
ALTER TABLE "ConnectionRequest" DROP CONSTRAINT "ConnectionRequest_runId_fkey";

-- AlterTable
ALTER TABLE "ConnectionRequest" DROP COLUMN "profileUrl",
DROP COLUMN "respondedAt",
DROP COLUMN "updatedAt",
ADD COLUMN     "attemptCount" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "currentCompany" TEXT,
ADD COLUMN     "currentTitle" TEXT,
ADD COLUMN     "errorCode" TEXT,
ADD COLUMN     "errorMessage" TEXT,
ADD COLUMN     "linkedinUrl" TEXT NOT NULL,
ADD COLUMN     "location" TEXT,
ADD COLUMN     "skipReason" TEXT,
ALTER COLUMN "runId" SET NOT NULL,
ALTER COLUMN "status" SET DEFAULT 'DISCOVERED';

-- AlterTable
ALTER TABLE "Contact" ADD COLUMN     "jobSnapshotCompany" TEXT,
ADD COLUMN     "jobSnapshotTitle" TEXT,
ADD COLUMN     "lastJobCheckAt" TIMESTAMP(3);

-- AlterTable
ALTER TABLE "ProspectingRun" DROP COLUMN "errorMessage",
DROP COLUMN "payload",
DROP COLUMN "result",
DROP COLUMN "updatedAt",
ADD COLUMN     "completedAt" TIMESTAMP(3),
ADD COLUMN     "connectInFlight" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "dailyCap" INTEGER NOT NULL DEFAULT 8,
ADD COLUMN     "discoveryDone" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "geoUrn" TEXT NOT NULL DEFAULT '101620260',
ADD COLUMN     "keywords" TEXT NOT NULL,
ADD COLUMN     "name" TEXT NOT NULL,
ADD COLUMN     "nextSearchPage" INTEGER NOT NULL DEFAULT 1,
ADD COLUMN     "pausedUntil" TIMESTAMP(3),
ADD COLUMN     "searchFailCount" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "searchUrl" TEXT NOT NULL,
ADD COLUMN     "startedAt" TIMESTAMP(3),
ADD COLUMN     "totalDiscovered" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "totalSent" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "weeklyCap" INTEGER NOT NULL DEFAULT 100,
ALTER COLUMN "status" SET DEFAULT 'DRAFT';

-- CreateTable
CREATE TABLE "ImportJob" (
    "id" TEXT NOT NULL,
    "ownerId" TEXT NOT NULL,
    "fileName" TEXT NOT NULL,
    "status" "ImportJobStatus" NOT NULL DEFAULT 'QUEUED',
    "updateOnly" BOOLEAN NOT NULL DEFAULT false,
    "stage" TEXT NOT NULL DEFAULT 'queued',
    "total" INTEGER NOT NULL DEFAULT 0,
    "processed" INTEGER NOT NULL DEFAULT 0,
    "payload" JSONB NOT NULL,
    "error" TEXT,
    "added" INTEGER NOT NULL DEFAULT 0,
    "updated" INTEGER NOT NULL DEFAULT 0,
    "removed" INTEGER NOT NULL DEFAULT 0,
    "unchanged" INTEGER NOT NULL DEFAULT 0,
    "companies" INTEGER NOT NULL DEFAULT 0,
    "newCompanies" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ImportJob_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ContactJobChange" (
    "id" TEXT NOT NULL,
    "contactId" TEXT NOT NULL,
    "detectedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "prevTitle" TEXT,
    "newTitle" TEXT,
    "prevCompany" TEXT,
    "newCompany" TEXT,

    CONSTRAINT "ContactJobChange_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ImportJob_ownerId_status_idx" ON "ImportJob"("ownerId", "status");

-- CreateIndex
CREATE INDEX "ImportJob_ownerId_createdAt_idx" ON "ImportJob"("ownerId", "createdAt");

-- CreateIndex
CREATE INDEX "ContactJobChange_contactId_idx" ON "ContactJobChange"("contactId");

-- CreateIndex
CREATE UNIQUE INDEX "ContactList_ownerId_name_key" ON "ContactList"("ownerId", "name");

-- AddForeignKey
ALTER TABLE "ImportJob" ADD CONSTRAINT "ImportJob_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ConnectionRequest" ADD CONSTRAINT "ConnectionRequest_runId_fkey" FOREIGN KEY ("runId") REFERENCES "ProspectingRun"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ContactJobChange" ADD CONSTRAINT "ContactJobChange_contactId_fkey" FOREIGN KEY ("contactId") REFERENCES "Contact"("id") ON DELETE CASCADE ON UPDATE CASCADE;
