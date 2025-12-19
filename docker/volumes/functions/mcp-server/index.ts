import { Hono } from 'hono'
import { McpServer, StreamableHttpTransport } from 'mcp-lite'
import { z } from 'zod'
import { zodToJsonSchema } from 'zod-to-json-schema'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { Client } from 'https://deno.land/x/postgres@v0.17.0/mod.ts'

// Create MCP server instance
const mcp = new McpServer({
  name: 'supabase-mcp-server',
  version: '1.0.0',
  schemaAdapter: (schema) => zodToJsonSchema(schema as z.ZodType),
})

// Initialize Supabase client
const supabaseUrl = Deno.env.get('SUPABASE_URL') ?? ''
const supabaseKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
const mcpApiKey = Deno.env.get('MCP_API_KEY') ?? 'default-super-secret-key'
const supabase = createClient(supabaseUrl, supabaseKey)

// Initialize Postgres client for raw SQL
const dbUrl = Deno.env.get('SUPABASE_DB_URL') ?? ''

// Define a tool to list tables
mcp.tool('list_tables', {
  description: 'List all tables in the public schema',
  inputSchema: z.object({}),
  handler: async () => {
    const { data, error } = await supabase
      .from('pg_tables')
      .select('tablename')
      .eq('schemaname', 'public')

    if (error) {
      return {
        content: [{ type: 'text', text: `Error: ${error.message}` }],
        isError: true,
      }
    }

    const tables = data.map((t: any) => t.tablename).join(', ')
    return {
      content: [{ type: 'text', text: `Tables in public schema: ${tables}` }],
    }
  },
})

// Define a tool to get table schema
mcp.tool('get_table_schema', {
  description: 'Get the schema (columns) of a specific table',
  inputSchema: z.object({
    table: z.string().describe('The name of the table'),
  }),
  handler: async (args: { table: string }) => {
    const client = new Client(dbUrl)
    try {
      await client.connect()
      const result = await client.queryObject(`
        SELECT column_name, data_type, is_nullable
        FROM information_schema.columns
        WHERE table_schema = 'public' AND table_name = $1
      `, [args.table])
      
      const json = JSON.stringify(result.rows, (key, value) =>
        typeof value === 'bigint' ? value.toString() : value, 2
      )
      return {
        content: [{ type: 'text', text: json }],
      }
    } catch (error: any) {
      return {
        content: [{ type: 'text', text: `Error: ${error.message}` }],
        isError: true,
      }
    } finally {
      await client.end()
    }
  },
})

// Define a tool to execute raw SQL
mcp.tool('execute_sql', {
  description: 'Execute raw SQL against the database',
  inputSchema: z.object({
    sql: z.string().describe('The SQL query to execute'),
  }),
  handler: async (args: { sql: string }) => {
    const client = new Client(dbUrl)
    try {
      await client.connect()
      const result = await client.queryObject(args.sql)
      // Handle BigInt serialization
      const json = JSON.stringify(result.rows, (key, value) =>
        typeof value === 'bigint' ? value.toString() : value, 2
      )
      return {
        content: [{ type: 'text', text: json }],
      }
    } catch (error: any) {
      return {
        content: [{ type: 'text', text: `SQL Error: ${error.message}` }],
        isError: true,
      }
    } finally {
      await client.end()
    }
  },
})

// Define a tool to search products
mcp.tool('search_products', {
  description: 'Search for cards/products by name',
  inputSchema: z.object({
    query: z.string(),
    limit: z.number().default(5),
  }),
  handler: async (args: { query: string; limit: number }) => {
    const { data, error } = await supabase
      .from('products')
      .select('id, name, set_id, rarity_id')
      .ilike('name', `%${args.query}%`)
      .limit(args.limit)

    if (error) {
      return {
        content: [{ type: 'text', text: `Error: ${error.message}` }],
        isError: true,
      }
    }

    return {
      content: [{ type: 'text', text: JSON.stringify(data, null, 2) }],
    }
  },
})

// Define a tool to list users
mcp.tool('list_users', {
  description: 'List all users in the auth schema',
  inputSchema: z.object({
    limit: z.number().default(10),
  }),
  handler: async (args: { limit: number }) => {
    const { data, error } = await supabase.auth.admin.listUsers({
      perPage: args.limit,
    })

    if (error) {
      return {
        content: [{ type: 'text', text: `Error: ${error.message}` }],
        isError: true,
      }
    }

    return {
      content: [{ type: 'text', text: JSON.stringify(data.users, null, 2) }],
    }
  },
})

// Define a tool to get a user by ID
mcp.tool('get_user', {
  description: 'Get details of a specific user by ID',
  inputSchema: z.object({
    id: z.string().describe('The UUID of the user'),
  }),
  handler: async (args: { id: string }) => {
    const { data, error } = await supabase.auth.admin.getUserById(args.id)

    if (error) {
      return {
        content: [{ type: 'text', text: `Error: ${error.message}` }],
        isError: true,
      }
    }

    return {
      content: [{ type: 'text', text: JSON.stringify(data.user, null, 2) }],
    }
  },
})

// Define a tool to list storage buckets
mcp.tool('list_buckets', {
  description: 'List all storage buckets',
  inputSchema: z.object({}),
  handler: async () => {
    const { data, error } = await supabase.storage.listBuckets()

    if (error) {
      return {
        content: [{ type: 'text', text: `Error: ${error.message}` }],
        isError: true,
      }
    }

    return {
      content: [{ type: 'text', text: JSON.stringify(data, null, 2) }],
    }
  },
})

// Define a tool to list files in a bucket
mcp.tool('list_files', {
  description: 'List files in a specific storage bucket',
  inputSchema: z.object({
    bucket: z.string().describe('The name of the bucket'),
    path: z.string().default('').describe('The path within the bucket'),
    limit: z.number().default(10),
  }),
  handler: async (args: { bucket: string; path: string; limit: number }) => {
    const { data, error } = await supabase.storage
      .from(args.bucket)
      .list(args.path, {
        limit: args.limit,
      })

    if (error) {
      return {
        content: [{ type: 'text', text: `Error: ${error.message}` }],
        isError: true,
      }
    }

    return {
      content: [{ type: 'text', text: JSON.stringify(data, null, 2) }],
    }
  },
})

// Define a tool to list all edge functions
mcp.tool('list_functions', {
  description: 'List all deployed edge functions',
  inputSchema: z.object({}),
  handler: async () => {
    try {
      const response = await fetch('http://172.18.0.1:8767/mcp', {
        method: 'POST',
        headers: { 
          'Content-Type': 'application/json',
          'X-MCP-Key': mcpApiKey
        },
        body: JSON.stringify({
          jsonrpc: '2.0',
          id: 1,
          method: 'tools/call',
          params: {
            name: 'list_functions',
            arguments: {},
          },
        }),
      })

      const result = await response.json()
      if (result.error) throw new Error(result.error.message)
      return result.result
    } catch (error: any) {
      return {
        content: [{ type: 'text', text: `Failed to list functions: ${error.message}` }],
        isError: true,
      }
    }
  },
})

// Define a tool to get function code
mcp.tool('get_function_code', {
  description: 'Get the source code of a deployed edge function',
  inputSchema: z.object({
    name: z.string().describe('The name of the function'),
  }),
  handler: async (args: { name: string }) => {
    try {
      const response = await fetch('http://172.18.0.1:8767/mcp', {
        method: 'POST',
        headers: { 
          'Content-Type': 'application/json',
          'X-MCP-Key': mcpApiKey
        },
        body: JSON.stringify({
          jsonrpc: '2.0',
          id: 1,
          method: 'tools/call',
          params: {
            name: 'get_function_code',
            arguments: args,
          },
        }),
      })

      const result = await response.json()
      if (result.error) throw new Error(result.error.message)
      return result.result
    } catch (error: any) {
      return {
        content: [{ type: 'text', text: `Failed to get function code: ${error.message}` }],
        isError: true,
      }
    }
  },
})

// Define a tool to delete an edge function
mcp.tool('delete_function', {
  description: 'Delete a deployed edge function',
  inputSchema: z.object({
    name: z.string().describe('The name of the function to delete'),
  }),
  handler: async (args: { name: string }) => {
    try {
      const response = await fetch('http://172.18.0.1:8767/mcp', {
        method: 'POST',
        headers: { 
          'Content-Type': 'application/json',
          'X-MCP-Key': mcpApiKey
        },
        body: JSON.stringify({
          jsonrpc: '2.0',
          id: 1,
          method: 'tools/call',
          params: {
            name: 'delete_function',
            arguments: args,
          },
        }),
      })

      const result = await response.json()
      if (result.error) throw new Error(result.error.message)
      return result.result
    } catch (error: any) {
      return {
        content: [{ type: 'text', text: `Failed to delete function: ${error.message}` }],
        isError: true,
      }
    }
  },
})

// Define a tool to deploy an edge function
mcp.tool('deploy_function', {
  description: 'Deploy a new edge function by providing its name and code',
  inputSchema: z.object({
    name: z.string().describe('The name of the function (e.g., "my-new-function")'),
    code: z.string().describe('The TypeScript code for the function'),
  }),
  handler: async (args: { name: string; code: string }) => {
    try {
      const response = await fetch('http://172.18.0.1:8767/mcp', {
        method: 'POST',
        headers: { 
          'Content-Type': 'application/json',
          'X-MCP-Key': mcpApiKey
        },
        body: JSON.stringify({
          jsonrpc: '2.0',
          id: 1,
          method: 'tools/call',
          params: {
            name: 'deploy_function',
            arguments: args,
          },
        }),
      })

      const result = await response.json()
      if (result.error) throw new Error(result.error.message)
      return result.result
    } catch (error: any) {
      return {
        content: [{ type: 'text', text: `Deployment failed: ${error.message}` }],
        isError: true,
      }
    }
  },
})

// Bind to HTTP transport
const transport = new StreamableHttpTransport()
const httpHandler = transport.bind(mcp)

// Root handler - matches the function name
const app = new Hono()

// Auth Middleware
app.use('/mcp-server/*', async (c, next) => {
  const apiKey = c.req.header('X-MCP-Key')
  if (apiKey !== mcpApiKey) {
    return c.json({ error: 'Unauthorized' }, 401)
  }
  await next()
})

// MCP protocol handler
const mcpApp = new Hono()

mcpApp.get('/', (c) => {
  return c.json({
    message: 'MCP Server on Supabase Edge Functions',
    endpoints: {
      mcp: '/mcp',
      health: '/health',
    },
  })
})

mcpApp.all('/mcp', async (c) => {
  const response = await httpHandler(c.req.raw)
  return response
})

mcpApp.get('/health', (c) => {
  return c.text('OK')
})

// Mount at /mcp-server (the function name)
app.route('/mcp-server', mcpApp)

export default app
