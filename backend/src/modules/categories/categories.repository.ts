import type { DatabaseClient } from "../../lib/prisma.js";

export class CategoriesRepository {
  constructor(private readonly database: DatabaseClient) {}

  listByUser(userId: string) {
    return this.database.category.findMany({
      where: { userId }, select: { id: true, name: true },
      orderBy: [{ name: "asc" }, { id: "asc" }],
    });
  }

  async belongsToUser(userId: string, id: string): Promise<boolean> {
    return await this.database.category.findFirst({
      where: { id, userId }, select: { id: true },
    }) !== null;
  }
}
