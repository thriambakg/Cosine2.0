moved {
  from = aws_sqs_queue.main
  to   = aws_sqs_queue.main[0]
}

moved {
  from = aws_iam_policy.sqs_read_policy
  to   = aws_iam_policy.sqs_read_policy[0]
}

moved {
  from = aws_iam_role_policy_attachment.sqs_read_policy
  to   = aws_iam_role_policy_attachment.sqs_read_policy[0]
}
