import { openDatabase } from "./client";

const { sqlite } = openDatabase();
sqlite.close();
process.stdout.write("Migrations applied.\n");
