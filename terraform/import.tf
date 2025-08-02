# Import Configuration for Existing Resources
# This file helps terraform adopt existing AWS resources

# Import existing KMS alias if it exists
import {
  to = aws_kms_alias.main
  id = "alias/cosine-staging"
}

# Import existing ALB if it exists  
import {
  to = module.alb.aws_lb.main
  id = "arn:aws:elasticloadbalancing:us-east-1:676206904242:loadbalancer/app/cosine-alb-staging/54b14f4b68e0cbab"
}

# Import existing target group if it exists
import {
  to = module.alb.aws_lb_target_group.frontend
  id = "arn:aws:elasticloadbalancing:us-east-1:676206904242:targetgroup/cosine-frontend-tg-staging/015a4554799dfeb4"
}

# Import existing ECR repository if it exists
import {
  to = module.ecr.aws_ecr_repository.frontend
  id = "cosine-frontend-staging"
}

# Import existing IAM role if it exists
import {
  to = module.vpc.aws_iam_role.flow_log
  id = "cosine-flow-log-role-staging"
}
