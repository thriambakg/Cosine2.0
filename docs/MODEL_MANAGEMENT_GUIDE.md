# Model Management Guide

This guide explains how to add and remove AI models from your Cosine application. The system supports multiple Bedrock models that can be selected by users in the chat interface.

## Table of Contents
- [Overview](#overview)
- [Adding New Models](#adding-new-models)
- [Removing Models](#removing-models)
- [Verification Steps](#verification-steps)
- [Troubleshooting](#troubleshooting)

## Overview

The model system consists of three main components:
1. **Backend Model Definitions** (`backend_app/src/Chat/agent.py`)
2. **Frontend Model Selection** (`frontend/react-app/src/pages/ChatPage.tsx`)
3. **IAM Permissions** (`terraform/main.tf`)

All three must be updated consistently when making model changes.

## Adding New Models

### Step 1: Add Model to Backend Agent

**File:** `backend_app/src/Chat/agent.py`

**Location:** Lines 579-612 (MODELS dictionary)

**Example - Adding a new model:**
```python
MODELS = {
    'claude-3-sonnet': BedrockModel(
        model_id="anthropic.claude-3-sonnet-20240229-v1:0",
        region="us-east-1"
    ),
    'claude-3-haiku': BedrockModel(
        model_id="anthropic.claude-3-haiku-20240307-v1:0",
        region="us-east-1"
    ),
    # ... existing models ...
    
    # NEW MODEL - Add your new model here
    'your-new-model': BedrockModel(
        model_id="provider.your-model-name-v1:0",
        region="us-east-1"
    )
}
```

**Key Points:**
- Use a descriptive key name (e.g., `'claude-4-sonnet'`)
- Use the exact Bedrock model ID from AWS console
- Keep region as `"us-east-1"` unless you have specific requirements

### Step 2: Add Model to Frontend Selection

**File:** `frontend/react-app/src/pages/ChatPage.tsx`

**Location:** Lines 1185-1192 (MenuItem components)

**Example - Adding the new model to dropdown:**
```tsx
<MenuItem value="claude-3-sonnet">Claude 3 Sonnet</MenuItem>
<MenuItem value="claude-3-haiku">Claude 3 Haiku</MenuItem>
<MenuItem value="claude-sonnet-4">Claude Sonnet 4</MenuItem>
<MenuItem value="nova-premier">Amazon Nova Premier</MenuItem>
<MenuItem value="nova-lite">Amazon Nova Lite</MenuItem>
<MenuItem value="llama3-3-70b">Llama 3.3 70B</MenuItem>
<MenuItem value="gpt-oss-120b">GPT-OSS 120B</MenuItem>
<MenuItem value="gpt-oss-20b">GPT-OSS 20B</MenuItem>

{/* NEW MODEL - Add your new model here */}
<MenuItem value="your-new-model">Your New Model Display Name</MenuItem>
```

**Key Points:**
- `value` must match the key from the backend MODELS dictionary
- Display name should be user-friendly
- Place new items in logical order (e.g., by provider, by size)

### Step 3: Add IAM Permissions

**File:** `terraform/main.tf`

**Location:** Lines 871-880 (Resource array in IAM policy)

**Example - Adding the new model ARN:**
```hcl
Resource = [
  "arn:aws:bedrock:*::foundation-model/anthropic.claude-3-sonnet-20240229-v1:0",
  "arn:aws:bedrock:*::foundation-model/anthropic.claude-3-haiku-20240307-v1:0",
  "arn:aws:bedrock:*::foundation-model/amazon.nova-lite-v1:0",
  "arn:aws:bedrock:*::foundation-model/openai.gpt-oss-120b-1:0",
  "arn:aws:bedrock:*::foundation-model/openai.gpt-oss-20b-1:0",
  
  # NEW MODEL - Add your new model ARN here
  "arn:aws:bedrock:*::foundation-model/provider.your-model-name-v1:0"
]
```

**Key Points:**
- Use the exact model ID from the backend configuration
- Follow the ARN format: `arn:aws:bedrock:*::foundation-model/{model-id}`
- Use wildcard `*` for region to allow all regions

### Step 4: Deploy Changes

```bash
# Navigate to terraform directory
cd terraform

# Plan the changes
terraform plan -var-file="environments/production.auto.tfvars"

# Apply the changes
terraform apply -var-file="environments/production.auto.tfvars"
```

## Removing Models

### Step 1: Remove from Backend

**File:** `backend_app/src/Chat/agent.py`

**Action:** Delete the model entry from the MODELS dictionary

**Example - Removing a model:**
```python
MODELS = {
    'claude-3-sonnet': BedrockModel(
        model_id="anthropic.claude-3-sonnet-20240229-v1:0",
        region="us-east-1"
    ),
    # 'claude-3-haiku': BedrockModel(  # REMOVED MODEL
    #     model_id="anthropic.claude-3-haiku-20240307-v1:0",
    #     region="us-east-1"
    # ),
    # ... rest of models
}
```

### Step 2: Remove from Frontend

**File:** `frontend/react-app/src/pages/ChatPage.tsx`

**Action:** Delete the MenuItem for the model

**Example - Removing from dropdown:**
```tsx
<MenuItem value="claude-3-sonnet">Claude 3 Sonnet</MenuItem>
{/* <MenuItem value="claude-3-haiku">Claude 3 Haiku</MenuItem> */} {/* REMOVED MODEL */}
<MenuItem value="claude-sonnet-4">Claude Sonnet 4</MenuItem>
// ... rest of models
```

### Step 3: Remove IAM Permission

**File:** `terraform/main.tf`

**Action:** Delete the ARN from the Resource array

**Example - Removing IAM permission:**
```hcl
Resource = [
  "arn:aws:bedrock:*::foundation-model/anthropic.claude-3-sonnet-20240229-v1:0",
  // "arn:aws:bedrock:*::foundation-model/anthropic.claude-3-haiku-20240307-v1:0", // REMOVED MODEL
  "arn:aws:bedrock:*::foundation-model/anthropic.claude-sonnet-4-20250514-v1:0",
  // ... rest of ARNs
]
```

### Step 4: Deploy Changes

```bash
cd terraform
terraform plan -var-file="environments/production.auto.tfvars"
terraform apply -var-file="environments/production.auto.tfvars"
```

## Verification Steps

### 1. Verify Model Availability

Check if the model is available in your AWS account:

```bash
# List all available models
aws bedrock list-foundation-models --region us-east-1

# Search for specific model
aws bedrock list-foundation-models --region us-east-1 \
  --query 'modelSummaries[?contains(modelId, `your-model-name`)].modelId'
```

### 2. Test Model Selection

1. Open the chat interface
2. Click the model dropdown
3. Verify the new model appears in the list
4. Select the new model
5. Send a test message
6. Check CloudWatch logs for any errors

### 3. Check IAM Permissions

```bash
# Test if Lambda can access the model
aws iam simulate-principal-policy \
  --policy-source-arn "arn:aws:iam::YOUR-ACCOUNT:role/cosine-chat-agent-production-execution-role" \
  --action-names "bedrock:InvokeModelWithResponseStream" \
  --resource-arns "arn:aws:bedrock:*::foundation-model/your-model-id"
```

## Troubleshooting

### Common Issues

#### 1. AccessDeniedException

**Error:** `User is not authorized to perform: bedrock:InvokeModelWithResponseStream`

**Solution:** 
- Verify the model ARN is correctly added to the IAM policy
- Ensure the model ID matches exactly between backend and IAM policy
- Deploy Terraform changes to update IAM permissions

#### 2. Model Not Found

**Error:** `Model not found` or `Invalid model identifier`

**Solution:**
- Verify the model ID is correct in the backend configuration
- Check if the model is available in your AWS region
- Some models may require special access approval

#### 3. Model Not Appearing in Dropdown

**Error:** Model doesn't show up in frontend dropdown

**Solution:**
- Verify the MenuItem was added to ChatPage.tsx
- Check that the `value` attribute matches the backend key
- Ensure the frontend was rebuilt after changes

#### 4. ValidationException - Inference Profile Required

**Error:** `Invocation of model ID [model] with on-demand throughput isn't supported. Retry your request with the ID or ARN of an inference profile that contains this model.`

**Solution:**
- Some models require inference profiles instead of direct model IDs
- Update the model ID to use the inference profile format (e.g., `us.meta.llama3-3-70b-instruct-v1:0` instead of `meta.llama3-3-70b-instruct-v1:0`)
- Update the corresponding IAM policy ARN to match
- Common inference profile prefixes: `us.`, `eu.`, `ap-southeast-1.`

### Model ID Reference

Common Bedrock model ID patterns:

```
# Anthropic Claude
anthropic.claude-3-sonnet-20240229-v1:0
anthropic.claude-3-haiku-20240307-v1:0

# Amazon Nova
amazon.nova-lite-v1:0


# OpenAI GPT-OSS
openai.gpt-oss-120b-1:0
openai.gpt-oss-20b-1:0
```

## Best Practices

1. **Always update all three files** (backend, frontend, IAM) when adding/removing models
2. **Test in development** before deploying to production
3. **Use descriptive names** for model keys and display names
4. **Follow naming conventions** (lowercase with hyphens for keys)
5. **Verify model availability** in your AWS account before adding
6. **Keep IAM permissions minimal** - only add what you actually use
7. **Document model changes** in commit messages and deployment notes

## Current Model Inventory

As of the last update, the system includes these models:

**Note**: Meta Llama 3.3 70B, Claude Sonnet 4, and Amazon Nova Premier were removed due to various compatibility issues. Meta Llama doesn't support tool use in streaming mode, while the other models may have similar limitations or are not yet fully supported.

| Key | Display Name | Model ID | Provider |
|-----|--------------|----------|----------|
| claude-3-sonnet | Claude 3 Sonnet | anthropic.claude-3-sonnet-20240229-v1:0 | Anthropic |
| claude-3-haiku | Claude 3 Haiku | anthropic.claude-3-haiku-20240307-v1:0 | Anthropic |
| nova-lite | Amazon Nova Lite | amazon.nova-lite-v1:0 | Amazon |
| gpt-oss-120b | GPT-OSS 120B | openai.gpt-oss-120b-1:0 | OpenAI |
| gpt-oss-20b | GPT-OSS 20B | openai.gpt-oss-20b-1:0 | OpenAI |

---

## Model Switching with Context Preservation

### How It Works

When you switch models during a chat session, the system ensures complete context preservation:

1. **Conversation History Injection**: The new model receives the complete conversation history from the database
2. **Agent Cache Management**: Old model agents are cleared to prevent stale context
3. **Message History Transfer**: All previous user messages and AI responses are added to the new agent's message history
4. **Seamless Transition**: No context loss when switching between models

### Technical Implementation

```python
# When switching models, the system:
# 1. Detects model switch for the session
# 2. Clears old agent cache
# 3. Creates new agent with conversation history
# 4. Injects all previous messages into the new agent

def _add_conversation_history_to_agent(self, agent, session_context):
    """Add conversation history to agent's message history"""
    conversation_history = session_context.get('context', {}).get('conversation_history', [])
    
    for conversation in conversation_history:
        if user_message := conversation.get('user_message', '').strip():
            agent.messages.append({'role': 'user', 'content': user_message})
        if agent_response := conversation.get('agent_response', '').strip():
            agent.messages.append({'role': 'assistant', 'content': agent_response})
```

### Benefits

- ✅ **No Context Loss**: Complete conversation history preserved
- ✅ **Model Flexibility**: Switch between any of the 5 supported models
- ✅ **Performance**: Cached agents for repeated model use
- ✅ **Reliability**: Fallback mechanisms for error handling

**Last Updated:** September 19, 2025  
**Version:** 1.1
