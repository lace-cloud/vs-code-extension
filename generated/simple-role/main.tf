module "attachment" {
  source     = "git::https://github.com/lace-cloud/registry-tf.git//modules/aws/iam/policy_attachment?ref=v1.0.0"
  policy_arn = module.policy.policy_arn
  role_name  = module.role.role_name
}
module "policy" {
  source          = "git::https://github.com/lace-cloud/registry-tf.git//modules/aws/iam/policy?ref=v1.0.0"
  policy_document = var.policy_document
  policy_name     = var.policy_name
  tags            = var.tags
}
module "role" {
  source             = "git::https://github.com/lace-cloud/registry-tf.git//modules/aws/iam/role?ref=v1.0.0"
  assume_role_policy = var.assume_role_policy
  name               = var.role_name
  tags               = var.tags
}
