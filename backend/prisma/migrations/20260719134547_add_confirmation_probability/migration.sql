/*
  Warnings:

  - You are about to drop the column `savingPct` on the `empty_legs` table. All the data in the column will be lost.

*/
-- AlterTable
ALTER TABLE "empty_legs" DROP COLUMN "savingPct",
ADD COLUMN     "SavingPct" INTEGER,
ADD COLUMN     "confirmationProbability" INTEGER;
