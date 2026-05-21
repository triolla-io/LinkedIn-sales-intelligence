/*
  Warnings:

  - Added the required column `updatedAt` to the `SequenceStep` table without a default value. This is not possible if the table is not empty.

*/
-- DropForeignKey
ALTER TABLE "Sequence" DROP CONSTRAINT "Sequence_contactListId_fkey";

-- DropForeignKey
ALTER TABLE "SequenceEnrollment" DROP CONSTRAINT "SequenceEnrollment_contactId_fkey";

-- AlterTable
ALTER TABLE "SequenceStep" ADD COLUMN     "updatedAt" TIMESTAMP(3) NOT NULL;

-- AddForeignKey
ALTER TABLE "Sequence" ADD CONSTRAINT "Sequence_contactListId_fkey" FOREIGN KEY ("contactListId") REFERENCES "ContactList"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SequenceEnrollment" ADD CONSTRAINT "SequenceEnrollment_contactId_fkey" FOREIGN KEY ("contactId") REFERENCES "Contact"("id") ON DELETE CASCADE ON UPDATE CASCADE;
