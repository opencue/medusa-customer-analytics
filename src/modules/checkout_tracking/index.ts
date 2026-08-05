import { Module } from "@medusajs/framework/utils"
import CheckoutTrackingModuleService from "./service"

export const CHECKOUT_TRACKING_MODULE = "checkout_tracking"

export default Module(CHECKOUT_TRACKING_MODULE, {
  service: CheckoutTrackingModuleService,
})
