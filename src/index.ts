#!/usr/bin/env node
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import {
  CallToolRequestSchema,
  ErrorCode,
  ListToolsRequestSchema,
  McpError,
  ServerResult,
} from '@modelcontextprotocol/sdk/types.js';
import { spawn } from 'child_process';
import { promisify } from 'util';
import { exec as execCallback } from 'child_process';

const exec = promisify(execCallback);

// Define interfaces for our tool arguments
interface ListModelsArgs {
  model_id?: string;
}

interface DeployModelArgs {
  model_id: string;
  instance_type?: string;
  engine_type?: string;
  service_type?: string;
  framework_type?: string;
  model_tag?: string;
  extra_params?: string;
  skip_confirm?: boolean;
  allow_local_deploy?: boolean;
}

interface StatusArgs {
  model_id?: string;
}

interface InvokeModelArgs {
  model_id: string;
  model_tag?: string;
  message: string;
}

interface DestroyModelArgs {
  model_id: string;
  model_tag?: string;
}

class EMDServer {
  private server: Server;
  private emdInstalled: boolean = false;

  constructor() {
    this.server = new Server(
      {
        name: 'emd-server', 
        version: '0.1.0',
      },
      {
        capabilities: {
          tools: {},
        },
      }
    );

    // Check and install EMD if needed
    this.checkAndInstallEMD().then(() => {
      this.emdInstalled = true;
      this.setupToolHandlers();
    }).catch((error) => {
      console.error('Failed to setup EMD:', error);
      process.exit(1);
    });
    
    // Error handling
    this.server.onerror = (error: any) => console.error('[MCP Error]', error);
    process.on('SIGINT', async () => {
      await this.server.close();
      process.exit(0);
    });
  }

  private setupToolHandlers() {
    this.server.setRequestHandler(ListToolsRequestSchema, async () => ({
      tools: [
        {
          name: 'list_models',
          description: 'List all supported models or get details about a specific model',
          inputSchema: {
            type: 'object',
            properties: {
              model_id: {
                type: 'string',
                description: 'Optional model ID to get details for a specific model',
              },
            },
          },
        },
        {
          name: 'deploy_model',
          description: 'Deploy a model to AWS services',
          inputSchema: {
            type: 'object',
            properties: {
              model_id: {
                type: 'string',
                description: 'Model ID to deploy',
              },
              instance_type: {
                type: 'string',
                description: 'The instance type to use',
              },
              engine_type: {
                type: 'string',
                description: 'The name of the inference engine',
              },
              service_type: {
                type: 'string',
                description: 'The name of the service',
              },
              framework_type: {
                type: 'string',
                description: 'The name of the framework',
              },
              model_tag: {
                type: 'string',
                description: 'Model tag, useful to create multiple models with same model ID',
              },
              extra_params: {
                type: 'string',
                description: 'Extra parameters as JSON string',
              },
              skip_confirm: {
                type: 'boolean',
                description: 'Skip confirmation',
              },
              allow_local_deploy: {
                type: 'boolean',
                description: 'Allow local deployment',
              },
            },
            required: ['model_id'],
          },
        },
        {
          name: 'check_status',
          description: 'Check the status of deployed models',
          inputSchema: {
            type: 'object',
            properties: {
              model_id: {
                type: 'string',
                description: 'Optional model ID to check status for a specific model',
              },
            },
          },
        },
        {
          name: 'invoke_model',
          description: 'Invoke a deployed model',
          inputSchema: {
            type: 'object',
            properties: {
              model_id: {
                type: 'string',
                description: 'Model ID to invoke',
              },
              model_tag: {
                type: 'string',
                description: 'Model tag',
              },
              message: {
                type: 'string',
                description: 'Message to send to the model',
              },
            },
            required: ['model_id', 'message'],
          },
        },
        {
          name: 'destroy_model',
          description: 'Destroy a deployed model',
          inputSchema: {
            type: 'object',
            properties: {
              model_id: {
                type: 'string',
                description: 'Model ID to destroy',
              },
              model_tag: {
                type: 'string',
                description: 'Model tag',
              },
            },
            required: ['model_id'],
          },
        },
      ],
    }));

    this.server.setRequestHandler(CallToolRequestSchema, async (request) => {
      const args = request.params.arguments || {};
      
      switch (request.params.name) {
        case 'list_models':
          return this.listModels(args as unknown as ListModelsArgs);
        case 'deploy_model':
          if (!('model_id' in args)) {
            return {
              content: [
                {
                  type: 'text',
                  text: 'Error: model_id is required',
                },
              ],
              isError: true,
            };
          }
          return this.deployModel(args as unknown as DeployModelArgs);
        case 'check_status':
          return this.checkStatus(args as unknown as StatusArgs);
        case 'invoke_model':
          if (!('model_id' in args) || !('message' in args)) {
            return {
              content: [
                {
                  type: 'text',
                  text: 'Error: model_id and message are required',
                },
              ],
              isError: true,
            };
          }
          return this.invokeModel(args as unknown as InvokeModelArgs);
        case 'destroy_model':
          if (!('model_id' in args)) {
            return {
              content: [
                {
                  type: 'text',
                  text: 'Error: model_id is required',
                },
              ],
              isError: true,
            };
          }
          return this.destroyModel(args as unknown as DestroyModelArgs);
        default:
          throw new McpError(
            ErrorCode.MethodNotFound,
            `Unknown tool: ${request.params.name}`
          );
      }
    });
  }

  private async checkAndInstallEMD(): Promise<void> {
    try {
      // Check if emd is installed
      await exec('emd version');
      return;
    } catch (error) {
      // If not found, install it
      console.log('EMD not found, installing via pip...');
      await exec('python3 -m pip install --user easy-model-deployer');
      // Verify installation
      await exec('emd version');
      console.log('EMD installed successfully');
    }
  }

  private async listModels(args: ListModelsArgs): Promise<ServerResult> {
    try {
      if (!this.emdInstalled) {
        return {
          content: [{
            type: 'text',
            text: 'Error: EMD is not installed. Please wait for installation to complete.'
          }],
          isError: true
        };
      }
      let command = 'emd list-supported-models';
      if (args.model_id) {
        command += ` ${args.model_id}`;
      }
      
      const { stdout, stderr } = await exec(command);
      
      if (stderr) {
        return {
          content: [
            {
              type: 'text',
              text: `Error listing models: ${stderr}`,
            },
          ],
          isError: true,
        };
      }
      
      return {
        content: [
          {
            type: 'text',
            text: stdout,
          },
        ],
      };
    } catch (error) {
      return {
        content: [
          {
            type: 'text',
            text: `Error listing models: ${(error as Error).message}`,
          },
        ],
        isError: true,
      };
    }
  }

  private async deployModel(args: DeployModelArgs): Promise<ServerResult> {
    try {
      let command = `emd deploy --model-id ${args.model_id}`;
      
      if (args.instance_type) {
        command += ` --instance-type ${args.instance_type}`;
      }
      
      if (args.engine_type) {
        command += ` --engine-type ${args.engine_type}`;
      }
      
      if (args.service_type) {
        command += ` --service-type ${args.service_type}`;
      }
      
      if (args.framework_type) {
        command += ` --framework-type ${args.framework_type}`;
      }
      
      if (args.model_tag) {
        command += ` --model-tag ${args.model_tag}`;
      }
      
      if (args.extra_params) {
        command += ` --extra-params '${args.extra_params}'`;
      }
      
      if (args.skip_confirm) {
        command += ` --skip-confirm`;
      }
      
      if (args.allow_local_deploy) {
        command += ` --allow-local-deploy`;
      }
      
      // For deployment, we'll use spawn to get real-time output
      return new Promise<ServerResult>((resolve) => {
        const process = spawn(command, { shell: true });
        let output = '';
        let errorOutput = '';
        
        process.stdout.on('data', (data: any) => {
          output += data.toString();
        });
        
        process.stderr.on('data', (data: any) => {
          errorOutput += data.toString();
        });
        
        process.on('close', (code: number) => {
          if (code !== 0) {
            resolve({
              content: [
                {
                  type: 'text',
                  text: `Deployment failed with code ${code}:\n${errorOutput || output}`,
                },
              ],
              isError: true,
            });
          } else {
            resolve({
              content: [
                {
                  type: 'text',
                  text: output,
                },
              ],
            });
          }
        });
      });
    } catch (error) {
      return {
        content: [
          {
            type: 'text',
            text: `Error deploying model: ${(error as Error).message}`,
          },
        ],
        isError: true,
      };
    }
  }

  private async checkStatus(args: StatusArgs): Promise<ServerResult> {
    try {
      let command = 'emd status';
      if (args.model_id) {
        command += ` ${args.model_id}`;
      }
      
      const { stdout, stderr } = await exec(command);
      
      if (stderr) {
        return {
          content: [
            {
              type: 'text',
              text: `Error checking status: ${stderr}`,
            },
          ],
          isError: true,
        };
      }
      
      return {
        content: [
          {
            type: 'text',
            text: stdout,
          },
        ],
      };
    } catch (error) {
      return {
        content: [
          {
            type: 'text',
            text: `Error checking status: ${(error as Error).message}`,
          },
        ],
        isError: true,
      };
    }
  }

  private async invokeModel(args: InvokeModelArgs): Promise<ServerResult> {
    try {
      // For invoke, we'll create a temporary script to handle the interaction
      const tempScriptContent = `
#!/usr/bin/env node
const { spawn } = require('child_process');
const readline = require('readline');

const modelId = ${JSON.stringify(args.model_id)};
const modelTag = ${JSON.stringify(args.model_tag || 'default')};
const message = ${JSON.stringify(args.message)};

const process = spawn('python', ['-m', 'emd', 'invoke', modelId, modelTag], { 
  stdio: ['pipe', 'pipe', 'pipe'] 
});

let output = '';
let waitingForPrompt = true;

process.stdout.on('data', (data) => {
  const text = data.toString();
  output += text;
  
  // Check if the CLI is waiting for user input
  if (waitingForPrompt && text.includes('User')) {
    waitingForPrompt = false;
    process.stdin.write(message + '\\n');
  }
  
  // Check if we got a response and can exit
  if (text.includes('Assistant:')) {
    // Wait a bit to ensure we get the full response
    setTimeout(() => {
      process.kill();
    }, 1000);
  }
});

process.stderr.on('data', (data) => {
  output += data.toString();
});

process.on('close', () => {
  console.log(output);
});
      `;
      
      const tempScriptPath = '/tmp/emd-invoke-script.js';
      await exec(`echo ${JSON.stringify(tempScriptContent)} > ${tempScriptPath}`);
      await exec(`chmod +x ${tempScriptPath}`);
      
      const { stdout, stderr } = await exec(`node ${tempScriptPath}`);
      
      // Clean up
      await exec(`rm ${tempScriptPath}`);
      
      if (stderr) {
        return {
          content: [
            {
              type: 'text',
              text: `Error invoking model: ${stderr}`,
            },
          ],
          isError: true,
        };
      }
      
      // Extract the assistant's response
      const responseMatch = stdout.match(/Assistant:(.*?)(?:\n|$)/s);
      const response = responseMatch ? responseMatch[1].trim() : stdout;
      
      return {
        content: [
          {
            type: 'text',
            text: response,
          },
        ],
      };
    } catch (error) {
      return {
        content: [
          {
            type: 'text',
            text: `Error invoking model: ${(error as Error).message}`,
          },
        ],
        isError: true,
      };
    }
  }

  private async destroyModel(args: DestroyModelArgs): Promise<ServerResult> {
    try {
      let command = `emd destroy ${args.model_id}`;
      if (args.model_tag) {
        command += ` ${args.model_tag}`;
      }
      
      const { stdout, stderr } = await exec(command);
      
      if (stderr) {
        return {
          content: [
            {
              type: 'text',
              text: `Error destroying model: ${stderr}`,
            },
          ],
          isError: true,
        };
      }
      
      return {
        content: [
          {
            type: 'text',
            text: stdout,
          },
        ],
      };
    } catch (error) {
      return {
        content: [
          {
            type: 'text',
            text: `Error destroying model: ${(error as Error).message}`,
          },
        ],
        isError: true,
      };
    }
  }

  async run() {
    const transport = new StdioServerTransport();
    await this.server.connect(transport);
    console.error('EMD MCP server running on stdio');
  }
}

const server = new EMDServer();
server.run().catch(console.error);
