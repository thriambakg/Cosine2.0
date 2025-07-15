# Terraform Remote State Setup

This directory contains the Terraform configuration with remote state backend for team collaboration and persistent state management.

## Problem Solved

- **State Persistence**: Terraform state is stored remotely in S3, preventing "fresh run" issues in CI/CD
- **Team Collaboration**: Multiple developers can work on the same infrastructure safely
- **Branch Isolation**: Each branch gets its own state file for independent development
- **State Locking**: DynamoDB prevents concurrent modifications that could corrupt state

## Directory Structure

```
terraform/
├── main.tf              # Main infrastructure configuration
├── variables.tf         # Variable declarations
├── terraform.auto.tfvars # Variable values (committed to git)
├── backend.tf           # Remote state backend configuration
├── outputs.tf           # Output definitions
├── bootstrap/           # Backend infrastructure setup
│   └── main.tf         # Creates S3 bucket and DynamoDB table
├── setup-backend.sh    # Bootstrap script (Linux/Mac)
├── setup-backend.ps1   # Bootstrap script (Windows)
└── README.md           # This file
```

# Terraform Remote State Setup

This directory contains the Terraform configuration with remote state backend for team collaboration and persistent state management.

## Problem Solved

- **State Persistence**: Terraform state is stored remotely in S3, preventing "fresh run" issues in CI/CD
- **Team Collaboration**: Multiple developers can work on the same infrastructure safely
- **Branch Isolation**: Each branch gets its own state file for independent development
- **State Locking**: DynamoDB prevents concurrent modifications that could corrupt state

## Directory Structure

```
terraform/
├── main.tf              # Main infrastructure configuration
├── variables.tf         # Variable declarations
├── terraform.auto.tfvars # Variable values (committed to git)
├── backend.tf           # Remote state backend configuration
├── outputs.tf           # Output definitions
├── bootstrap/           # Backend infrastructure setup
│   └── main.tf         # Creates S3 bucket and DynamoDB table
└── README.md           # This file
```

## How It Works

### Automatic Setup (Pipeline-Managed)

The GitHub Actions pipeline automatically:

1. **Checks for backend infrastructure** - Verifies if S3 bucket exists
2. **Creates backend if needed** - Runs bootstrap Terraform to create S3 + DynamoDB
3. **Initializes with remote state** - Configures branch-specific state files
4. **Migrates existing state** - If local state exists, migrates it to remote
5. **Runs normal Terraform workflow** - Plan, validate, apply

### No Local Setup Required!

Simply:
1. **Push your changes** to any branch
2. **GitHub Actions handles everything** automatically
3. **State is persistent** across all pipeline runs

## Branch-Based Environments

Each Git branch automatically gets its own state file:

- `staging` branch → `environments/staging/terraform.tfstate`
- `production` branch → `environments/production/terraform.tfstate`
- `feature/xyz` branch → `environments/feature/xyz/terraform.tfstate`

## Team Collaboration Workflow

### For New Team Members:

1. **Clone the repository**
2. **Switch to your branch**
3. **Initialize Terraform** (backend is already configured):
   ```bash
   cd terraform
   terraform init -backend-config="key=environments/$(git branch --show-current)/terraform.tfstate"
   ```
4. **Work normally**:
   ```bash
   terraform plan
   terraform apply
   ```

### For CI/CD (GitHub Actions):

The workflow automatically:
- Uses branch name for state file isolation
- Handles backend initialization
- Prevents concurrent runs with state locking

## State Management Commands

```bash
# View current state
terraform show

# List resources in state
terraform state list

# Import existing resource
terraform import aws_s3_bucket.example bucket-name

# Remove resource from state (doesn't destroy)
terraform state rm aws_s3_bucket.example

# Move resource in state
terraform state mv aws_s3_bucket.old aws_s3_bucket.new
```

## Security Features

- **S3 Bucket**: Versioned, encrypted, private access only
- **DynamoDB**: State locking prevents concurrent modifications
- **IAM**: GitHub Actions uses least-privilege access
- **Branch Isolation**: Each environment has separate state

## Troubleshooting

### "Backend configuration changed"
```bash
terraform init -reconfigure
```

### State is locked
```bash
# Check lock status
terraform force-unlock LOCK_ID
```

### Start fresh (careful!)
```bash
# Remove local state cache
rm -rf .terraform
terraform init -backend-config="key=environments/$(git branch --show-current)/terraform.tfstate"
```

## Cost Optimization

- **S3**: Pay-per-use storage (minimal cost for state files)
- **DynamoDB**: On-demand billing (only pay for operations)
- **Estimated cost**: < $1/month for typical usage

## Backend Configuration Details

```hcl
backend "s3" {
  bucket         = "cosine-terraform-state-bucket"
  key            = "environments/{branch-name}/terraform.tfstate"
  region         = "us-east-1"
  dynamodb_table = "cosine-terraform-locks"
  encrypt        = true
}
```
