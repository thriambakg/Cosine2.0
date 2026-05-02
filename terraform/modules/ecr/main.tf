# Container Registry Module
# modules/ecr/main.tf

resource "aws_ecr_repository" "frontend" {
  name                 = "${var.project_name}-${var.repository_name}-${var.environment}"
  image_tag_mutability = "MUTABLE"
  force_delete         = true # Allow deletion even with images

  image_scanning_configuration {
    scan_on_push = true
  }

  encryption_configuration {
    encryption_type = "KMS"
    kms_key         = var.kms_key_arn
  }

  tags = merge(var.tags, {
    Name = "${var.project_name}-${var.repository_name}-ecr-${var.environment}"
  })

  lifecycle {
    ignore_changes = [name]
    # Force recreation when image_tag_mutability changes
    create_before_destroy = true
  }
}

# ECR Lifecycle Policy
resource "aws_ecr_lifecycle_policy" "frontend" {
  repository = aws_ecr_repository.frontend.name

  policy = jsonencode({
    rules = [
      {
        rulePriority = 1
        description  = "Keep last 30 images"
        selection = {
          tagStatus     = "tagged"
          tagPrefixList = ["v"]
          countType     = "imageCountMoreThan"
          countNumber   = 30
        }
        action = {
          type = "expire"
        }
      },
      {
        rulePriority = 2
        description  = "Delete untagged images"
        selection = {
          tagStatus   = "untagged"
          countType   = "sinceImagePushed"
          countUnit   = "days"
          countNumber = 1
        }
        action = {
          type = "expire"
        }
      }
    ]
  })
}

# Single repository policy (replaces duplicate frontend + lambda_access resources that overwrote each other in AWS).
# GetAuthorizationToken is IAM-only, not ECR repo policy.
resource "aws_ecr_repository_policy" "frontend" {
  repository = aws_ecr_repository.frontend.name

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = concat(
      [
        {
          Sid    = "AllowSameAccountPull"
          Effect = "Allow"
          Principal = {
            AWS = "arn:aws:iam::${data.aws_caller_identity.current.account_id}:root"
          }
          Action = [
            "ecr:GetDownloadUrlForLayer",
            "ecr:BatchGetImage",
            "ecr:BatchCheckLayerAvailability"
          ]
        }
      ],
      length(var.image_pull_principal_arns) > 0 ? [
        {
          Sid    = "AllowLambdaExecutionRoles"
          Effect = "Allow"
          Principal = {
            AWS = var.image_pull_principal_arns
          }
          Action = [
            "ecr:GetDownloadUrlForLayer",
            "ecr:BatchGetImage",
            "ecr:BatchCheckLayerAvailability"
          ]
        }
      ] : [],
      [
        {
          Sid    = "AllowLambdaServicePull"
          Effect = "Allow"
          Principal = {
            Service = "lambda.amazonaws.com"
          }
          Action = [
            "ecr:GetDownloadUrlForLayer",
            "ecr:BatchGetImage",
            "ecr:BatchCheckLayerAvailability"
          ]
          Condition = {
            StringLike = {
              "aws:sourceArn" = "arn:aws:lambda:${data.aws_region.current.name}:${data.aws_caller_identity.current.account_id}:function:${var.project_name}-chat-agent-${var.environment}*"
            }
          }
        }
      ]
    )
  })
}

data "aws_caller_identity" "current" {}
data "aws_region" "current" {}
