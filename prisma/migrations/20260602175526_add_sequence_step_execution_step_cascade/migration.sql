-- DropForeignKey
ALTER TABLE "SequenceStepExecution" DROP CONSTRAINT "SequenceStepExecution_stepId_fkey";

-- AddForeignKey
ALTER TABLE "SequenceStepExecution" ADD CONSTRAINT "SequenceStepExecution_stepId_fkey" FOREIGN KEY ("stepId") REFERENCES "SequenceStep"("id") ON DELETE CASCADE ON UPDATE CASCADE;
