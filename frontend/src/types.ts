export interface Server {
  id: number
  name?: string
  username: string
  host: string
  port: number
  terminal_type: string
  has_password: boolean
  created_at: string
}

export interface AutoApproval {
  id: number
  pattern: string
  is_regex: number
  description?: string
  scope: string
  server_id?: number
  created_at: string
}

export interface Conversation {
  id: number
  server_id?: number
  title: string
  messages?: string
  created_at: string
  updated_at: string
}

export interface AiModelCapabilities {
  multimodal?: boolean
  deep_thinking?: boolean
  tool_calling?: boolean
  function_calling?: boolean
  [key: string]: boolean | undefined
}

export interface AiModel {
  id: number
  model_name: string
  display_name: string
  provider: string
  capabilities: AiModelCapabilities
  enabled: 'Y' | 'N'
}
