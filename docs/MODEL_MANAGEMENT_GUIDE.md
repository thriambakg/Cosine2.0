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
  "arn:aws:bedrock:*::foundation-model/anthropic.claude-sonnet-4-20250514-v1:0",
  "arn:aws:bedrock:*::foundation-model/amazon.nova-premier-v1:0",
  "arn:aws:bedrock:*::foundation-model/amazon.nova-lite-v1:0",
  # Foundation model for Meta Llama (native AWS format)
  "arn:aws:bedrock:*::foundation-model/meta.llama3-3-70b-instruct-v1:0",
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
anthropic.claude-sonnet-4-20250514-v1:0

# Amazon Nova
amazon.nova-premier-v1:0
amazon.nova-lite-v1:0

# Meta Llama (native AWS format)
meta.llama3-3-70b-instruct-v1:0

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

| Key | Display Name | Model ID | Provider |
|-----|--------------|----------|----------|
| claude-3-sonnet | Claude 3 Sonnet | anthropic.claude-3-sonnet-20240229-v1:0 | Anthropic |
| claude-3-haiku | Claude 3 Haiku | anthropic.claude-3-haiku-20240307-v1:0 | Anthropic |
| claude-sonnet-4 | Claude Sonnet 4 | anthropic.claude-sonnet-4-20250514-v1:0 | Anthropic |
| nova-premier | Amazon Nova Premier | amazon.nova-premier-v1:0 | Amazon |
| nova-lite | Amazon Nova Lite | amazon.nova-lite-v1:0 | Amazon |
| llama3-3-70b | Llama 3.3 70B | meta.llama3-3-70b-instruct-v1:0 | Meta |
| gpt-oss-120b | GPT-OSS 120B | openai.gpt-oss-120b-1:0 | OpenAI |
| gpt-oss-20b | GPT-OSS 20B | openai.gpt-oss-20b-1:0 | OpenAI |

---

**Last Updated:** September 19, 2025  
**Version:** 1.0
