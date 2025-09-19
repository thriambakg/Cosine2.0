# Model Switching Test Guide

This guide helps you test that all 8 models can be switched between during a single chat session.

## Current Model Configuration

| Model Key | Display Name | Model ID | Provider | Status |
|-----------|--------------|----------|----------|--------|
| claude-3-sonnet | Claude 3 Sonnet | anthropic.claude-3-sonnet-20240229-v1:0 | Anthropic | ✅ Working |
| claude-3-haiku | Claude 3 Haiku | anthropic.claude-3-haiku-20240307-v1:0 | Anthropic | ✅ Working |
| claude-sonnet-4 | Claude Sonnet 4 | anthropic.claude-sonnet-4-20250514-v1:0 | Anthropic | 🔍 Needs Testing |
| nova-premier | Amazon Nova Premier | amazon.nova-premier-v1:0 | Amazon | 🔍 Needs Testing |
| nova-lite | Amazon Nova Lite | amazon.nova-lite-v1:0 | Amazon | 🔍 Needs Testing |
| llama3-3-70b | Llama 3.3 70B | us.meta.llama3-3-70b-instruct-v1:0 | Meta | 🔍 Needs Testing |
| gpt-oss-120b | GPT-OSS 120B | openai.gpt-oss-120b-1:0 | OpenAI | ✅ Working |
| gpt-oss-20b | GPT-OSS 20B | openai.gpt-oss-20b-1:0 | OpenAI | 🔍 Needs Testing |

## Testing Procedure

### Step 1: Test Each Model Individually

For each model, create a new chat session and test:

1. **Start a new chat session**
2. **Select the model from the dropdown**
3. **Send a test message**: "Hello, what AI model are you using?"
4. **Verify the response mentions the correct model**
5. **Check CloudWatch logs for any errors**

### Step 2: Test Model Switching in Same Session

1. **Start with Claude 3 Sonnet** (known working model)
2. **Send a message**: "Hello, I'm testing model switching"
3. **Switch to GPT-OSS 120B**
4. **Send**: "What model are you using now?"
5. **Continue switching between all 8 models**
6. **Send a test message after each switch**

### Step 3: Expected Behavior

- ✅ **Successful Model Switch**: New message uses the selected model
- ✅ **Session Continuity**: Previous conversation context is maintained
- ✅ **Model Identification**: Each model should identify itself correctly
- ❌ **Failed Switch**: Error message or fallback to default model

## Common Issues and Solutions

### Issue 1: ValidationException - Inference Profile Required

**Error**: `Invocation of model ID [model] with on-demand throughput isn't supported`

**Solution**: The Strands SDK uses ConverseStream API, which requires inference profiles for Meta Llama:
```python
# Strands SDK uses ConverseStream API (requires inference profiles)
# Meta Llama models require inference profiles
# Instead of: "meta.llama3-3-70b-instruct-v1:0"
# Use: "us.meta.llama3-3-70b-instruct-v1:0"

# Other models use foundation model ARNs
"anthropic.claude-3-sonnet-20240229-v1:0"  # ✅ Correct
"amazon.nova-premier-v1:0"  # ✅ Correct
```

**Note**: IAM policy includes both foundation model and inference profile ARNs for Meta Llama to ensure compatibility.

### Issue 2: AccessDeniedException

**Error**: `User is not authorized to perform: bedrock:InvokeModelWithResponseStream`

**Solution**: 
1. Check if model ARN is in IAM policy
2. Deploy Terraform changes
3. Verify model is enabled in Bedrock console

### Issue 3: Model Not Available in Region

**Error**: `Model not found` or `Invalid model identifier`

**Solution**:
1. Check model availability in AWS Bedrock console
2. Verify region compatibility
3. Enable model access if required

## Model-Specific Requirements

### Anthropic Claude Models
- **Direct Model IDs**: ✅ Should work with current configuration
- **Access Requirements**: May need explicit access approval in Bedrock console

### Amazon Nova Models
- **Potential Inference Profile**: 🔍 May need `us.amazon.nova-premier-v1:0` format
- **New Models**: Recently released, may have special requirements

### Meta Llama Models
- **Inference Profile Required**: ✅ Already fixed for Llama 3.3 70B
- **Access Requirements**: May need explicit access approval

### OpenAI GPT-OSS Models
- **Direct Model IDs**: ✅ Should work with current configuration
- **Access Requirements**: May need explicit access approval

## Testing Checklist

- [ ] Claude 3 Sonnet works individually
- [ ] Claude 3 Haiku works individually  
- [ ] Claude Sonnet 4 works individually
- [ ] Amazon Nova Premier works individually
- [ ] Amazon Nova Lite works individually
- [ ] Llama 3.3 70B works individually
- [ ] GPT-OSS 120B works individually
- [ ] GPT-OSS 20B works individually
- [ ] Can switch from Claude 3 Sonnet to GPT-OSS 120B
- [ ] Can switch from GPT-OSS 120B to Llama 3.3 70B
- [ ] Can switch between all Anthropic models
- [ ] Can switch between all Amazon models
- [ ] Can switch between all Meta models
- [ ] Can switch between all OpenAI models
- [ ] Can switch from any model to any other model
- [ ] Session context is preserved across model switches
- [ ] No errors in CloudWatch logs during switching

## Quick Test Commands

### AWS CLI - Check Model Availability
```bash
# List all available models
aws bedrock list-foundation-models --region us-east-1

# Check specific models
aws bedrock list-foundation-models --region us-east-1 \
  --query 'modelSummaries[?contains(modelId, `claude-sonnet-4`) || contains(modelId, `nova-premier`) || contains(modelId, `nova-lite`)].modelId'
```

### AWS CLI - Test IAM Permissions
```bash
# Test specific model access
aws iam simulate-principal-policy \
  --policy-source-arn "arn:aws:iam::YOUR-ACCOUNT:role/cosine-chat-agent-production-execution-role" \
  --action-names "bedrock:InvokeModelWithResponseStream" \
  --resource-arns "arn:aws:bedrock:*::foundation-model/anthropic.claude-sonnet-4-20250514-v1:0"
```

## Troubleshooting Logs

When testing, watch for these log patterns:

### Successful Model Switch
```
[INFO] Creating session agent with model: [model-name]
[INFO] Created new context-aware agent for session [session-id] with model [model-name]
```

### Failed Model Switch
```
[ERROR] ValidationException: Invocation of model ID [model] with on-demand throughput isn't supported
[ERROR] AccessDeniedException: User is not authorized to perform: bedrock:InvokeModelWithResponseStream
```

---

**Last Updated**: January 19, 2025  
**Version**: 1.0
