import { Pool } from "@neondatabase/serverless"

let pool: Pool | null = null

function getPool(): Pool {
  if (!pool) {
    if (!process.env.DATABASE_URL) {
      throw new Error("DATABASE_URL environment variable is required")
    }
    const dbUrl = process.env.DATABASE_URL.replace(/&?channel_binding=[^&]*/g, "")
    pool = new Pool({ connectionString: dbUrl })
  }
  return pool
}

export async function sql(strings: TemplateStringsArray, ...values: any[]): Promise<any[]> {
  let query = ""
  strings.forEach((str, i) => {
    query += str
    if (i < values.length) query += `$${i + 1}`
  })
  const res = await getPool().query(query, values)
  return res.rows
}

export async function rawSql(text: string, params?: any[]): Promise<any[]> {
  const res = await getPool().query(text, params)
  return res.rows
}
