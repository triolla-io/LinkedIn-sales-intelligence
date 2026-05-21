-- AlterTable
ALTER TABLE "Contact" ADD COLUMN     "manualFields" TEXT[] DEFAULT ARRAY[]::TEXT[];
