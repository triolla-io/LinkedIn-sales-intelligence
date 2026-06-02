-- DropForeignKey
ALTER TABLE "Sequence" DROP CONSTRAINT "Sequence_contactListId_fkey";

-- AlterTable
ALTER TABLE "Sequence" ALTER COLUMN "contactListId" DROP NOT NULL;

-- AlterTable
ALTER TABLE "SequenceStep" ADD COLUMN     "sendHourEnd" INTEGER;

-- AddForeignKey
ALTER TABLE "Sequence" ADD CONSTRAINT "Sequence_contactListId_fkey" FOREIGN KEY ("contactListId") REFERENCES "ContactList"("id") ON DELETE SET NULL ON UPDATE CASCADE;
