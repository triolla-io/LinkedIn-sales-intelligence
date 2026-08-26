-- AlterTable
ALTER TABLE "PersonProfile" ADD COLUMN "reasoning" TEXT;

-- AlterTable
ALTER TABLE "Contact" ADD COLUMN "channels" TEXT[] DEFAULT ARRAY[]::TEXT[];
