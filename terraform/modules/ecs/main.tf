# ECS Container Service Module
# modules/ecs/main.tf

# Data source for ECS CloudWatch Log Group
data "aws_cloudwatch_log_group" "ecs" {
  name = var.ecs_log_group_name
}

# Data source for Frontend CloudWatch Log Group
data "aws_cloudwatch_log_group" "frontend" {
  name = var.frontend_log_group_name
}

# ECS Cluster
resource "aws_ecs_cluster" "main" {
  name = "${var.project_name}-cluster-${var.environment}"

  configuration {
    execute_command_configuration {
      kms_key_id = var.kms_key_arn
      logging    = "OVERRIDE"

      log_configuration {
        cloud_watch_encryption_enabled = true
        cloud_watch_log_group_name     = data.aws_cloudwatch_log_group.ecs.name
      }
    }
  }

  setting {
    name  = "containerInsights"
    value = "enabled"
  }

  tags = merge(var.tags, {
    Name = "${var.project_name}-ecs-cluster-${var.environment}"
  })
}

# ECS Task Execution Role
resource "aws_iam_role" "ecs_task_execution_role" {
  name = "${var.project_name}-ecs-task-execution-role-${var.environment}"

  assume_role_policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Action = "sts:AssumeRole"
        Effect = "Allow"
        Principal = {
          Service = "ecs-tasks.amazonaws.com"
        }
      }
    ]
  })

  tags = merge(var.tags, {
    Name = "${var.project_name}-ecs-execution-role-${var.environment}"
  })
}

# ECS Task Role (for the container itself)
resource "aws_iam_role" "ecs_task_role" {
  name = "${var.project_name}-ecs-task-role-${var.environment}"

  assume_role_policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Action = "sts:AssumeRole"
        Effect = "Allow"
        Principal = {
          Service = "ecs-tasks.amazonaws.com"
        }
      }
    ]
  })

  tags = merge(var.tags, {
    Name = "${var.project_name}-ecs-task-role-${var.environment}"
  })
}

# Attach the Amazon ECS task execution role policy
resource "aws_iam_role_policy_attachment" "ecs_task_execution_role_policy" {
  role       = aws_iam_role.ecs_task_execution_role.name
  policy_arn = "arn:aws:iam::aws:policy/service-role/AmazonECSTaskExecutionRolePolicy"
}

# Custom policy for ECR access
resource "aws_iam_role_policy" "ecs_task_execution_custom" {
  name = "${var.project_name}-ecs-execution-custom-${var.environment}"
  role = aws_iam_role.ecs_task_execution_role.id

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Effect = "Allow"
        Action = [
          "ecr:GetAuthorizationToken"
        ]
        Resource = "*"
      },
      {
        Effect = "Allow"
        Action = [
          "ecr:BatchCheckLayerAvailability",
          "ecr:GetDownloadUrlForLayer",
          "ecr:BatchGetImage"
        ]
        Resource = var.ecr_repository_arn
      },
      {
        Effect = "Allow"
        Action = [
          "logs:CreateLogStream",
          "logs:PutLogEvents"
        ]
        Resource = [
          data.aws_cloudwatch_log_group.frontend.arn,
          "${data.aws_cloudwatch_log_group.frontend.arn}:log-stream:*"
        ]
      },
      {
        Effect = "Allow"
        Action = [
          "kms:Decrypt"
        ]
        Resource = var.kms_key_arn
      }
    ]
  })
}

# ECS Task Definition
resource "aws_ecs_task_definition" "frontend" {
  family                   = "${var.project_name}-frontend-${var.environment}"
  network_mode             = "awsvpc"
  requires_compatibilities = ["FARGATE"]
  cpu                      = var.task_cpu
  memory                   = var.task_memory
  execution_role_arn       = aws_iam_role.ecs_task_execution_role.arn
  task_role_arn            = aws_iam_role.ecs_task_role.arn

  container_definitions = jsonencode([
    {
      name  = "frontend"
      image = "${var.ecr_repository_url}:latest"

      essential = true

      portMappings = [
        {
          containerPort = 3000
          protocol      = "tcp"
        }
      ]

      environment = [
        {
          name  = "NODE_ENV"
          value = "production"
        },
        {
          name  = "NEXT_PUBLIC_AWS_REGION"
          value = var.aws_region
        },
        {
          name  = "NEXT_PUBLIC_COGNITO_USER_POOL_ID"
          value = var.cognito_user_pool_id
        },
        {
          name  = "NEXT_PUBLIC_COGNITO_CLIENT_ID"
          value = var.cognito_client_id
        },
        {
          name  = "NEXT_PUBLIC_COGNITO_DOMAIN"
          value = var.cognito_domain
        },
        {
          name  = "NEXT_PUBLIC_API_GATEWAY_URL"
          value = var.api_gateway_url
        }
      ]

      logConfiguration = {
        logDriver = "awslogs"
        options = {
          "awslogs-group"         = data.aws_cloudwatch_log_group.frontend.name
          "awslogs-region"        = var.aws_region
          "awslogs-stream-prefix" = "ecs"
        }
      }

      healthCheck = {
        command = [
          "CMD-SHELL",
          "curl -f http://localhost:3000/api/health || exit 1"
        ]
        interval    = 30
        timeout     = 5
        retries     = 3
        startPeriod = 60
      }

      # Security options
      readonlyRootFilesystem = false
      privileged             = false

      # Resource limits
      memoryReservation = var.task_memory_reservation
    }
  ])

  # Runtime platform for Fargate
  runtime_platform {
    operating_system_family = "LINUX"
    cpu_architecture        = "X86_64"
  }

  tags = merge(var.tags, {
    Name = "${var.project_name}-frontend-task-${var.environment}"
  })
}

# ECS Service
resource "aws_ecs_service" "frontend" {
  name            = "${var.project_name}-frontend-service-${var.environment}"
  cluster         = aws_ecs_cluster.main.id
  task_definition = aws_ecs_task_definition.frontend.arn
  desired_count   = var.desired_count
  launch_type     = "FARGATE"

  # Deployment configuration
  deployment_maximum_percent         = 200
  deployment_minimum_healthy_percent = 100

  # Network configuration
  network_configuration {
    subnets          = var.private_subnet_ids
    security_groups  = [aws_security_group.ecs_tasks.id]
    assign_public_ip = false
  }

  # Load balancer configuration
  load_balancer {
    target_group_arn = var.target_group_arn
    container_name   = "frontend"
    container_port   = 3000
  }

  # Service discovery (optional)
  dynamic "service_registries" {
    for_each = var.enable_service_discovery ? [1] : []
    content {
      registry_arn = aws_service_discovery_service.frontend[0].arn
    }
  }

  # Enable deployment circuit breaker
  deployment_circuit_breaker {
    enable   = true
    rollback = true
  }

  # Enable execute command for debugging
  enable_execute_command = var.enable_execute_command

  depends_on = [aws_iam_role_policy_attachment.ecs_task_execution_role_policy]

  tags = merge(var.tags, {
    Name = "${var.project_name}-frontend-service-${var.environment}"
  })
}

# Security Group for ECS Tasks
resource "aws_security_group" "ecs_tasks" {
  name        = "${var.project_name}-ecs-tasks-${var.environment}"
  description = "Security group for ECS tasks"
  vpc_id      = var.vpc_id

  ingress {
    from_port       = 3000
    to_port         = 3000
    protocol        = "tcp"
    security_groups = [var.alb_security_group_id]
    description     = "Allow traffic from ALB"
  }

  # tfsec:ignore:aws-ec2-no-public-egress-sgr - HTTPS egress required for API calls and package downloads
  egress {
    from_port   = 443
    to_port     = 443
    protocol    = "tcp"
    cidr_blocks = ["0.0.0.0/0"]
    description = "Allow HTTPS outbound for package downloads"
  }

  # tfsec:ignore:aws-ec2-no-public-egress-sgr - HTTP egress required for package downloads and health checks
  egress {
    from_port   = 80
    to_port     = 80
    protocol    = "tcp"
    cidr_blocks = ["0.0.0.0/0"]
    description = "Allow HTTP outbound for package downloads"
  }

  # tfsec:ignore:aws-ec2-no-public-egress-sgr - DNS egress required for domain resolution
  egress {
    from_port   = 53
    to_port     = 53
    protocol    = "udp"
    cidr_blocks = ["0.0.0.0/0"]
    description = "Allow DNS resolution"
  }

  tags = merge(var.tags, {
    Name = "${var.project_name}-ecs-tasks-sg-${var.environment}"
  })
}

# Service Discovery (optional)
resource "aws_service_discovery_private_dns_namespace" "main" {
  count       = var.enable_service_discovery ? 1 : 0
  name        = "${var.project_name}-${var.environment}.local"
  description = "Service discovery namespace for ${var.project_name}"
  vpc         = var.vpc_id

  tags = merge(var.tags, {
    Name = "${var.project_name}-service-discovery-${var.environment}"
  })
}

resource "aws_service_discovery_service" "frontend" {
  count = var.enable_service_discovery ? 1 : 0
  name  = "frontend"

  dns_config {
    namespace_id = aws_service_discovery_private_dns_namespace.main[0].id

    dns_records {
      ttl  = 10
      type = "A"
    }

    routing_policy = "MULTIVALUE"
  }

  tags = merge(var.tags, {
    Name = "${var.project_name}-frontend-discovery-${var.environment}"
  })
}
