package com.blyp.mobile.billing

import com.android.billingclient.api.AcknowledgePurchaseParams
import com.android.billingclient.api.BillingClient
import com.android.billingclient.api.BillingClient.BillingResponseCode
import com.android.billingclient.api.BillingClientStateListener
import com.android.billingclient.api.BillingFlowParams
import com.android.billingclient.api.BillingResult
import com.android.billingclient.api.ConsumeParams
import com.android.billingclient.api.PendingPurchasesParams
import com.android.billingclient.api.ProductDetails
import com.android.billingclient.api.Purchase
import com.android.billingclient.api.PurchasesUpdatedListener
import com.android.billingclient.api.QueryProductDetailsParams
import com.android.billingclient.api.QueryPurchasesParams
import com.facebook.react.bridge.Arguments
import com.facebook.react.bridge.Promise
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.ReactContextBaseJavaModule
import com.facebook.react.bridge.ReactMethod
import com.facebook.react.bridge.ReadableArray

class PlayBillingModule(private val reactContext: ReactApplicationContext) :
    ReactContextBaseJavaModule(reactContext), PurchasesUpdatedListener {

    private var billingClient: BillingClient? = null
    private var pendingPromise: Promise? = null
    private var pendingSku: String? = null
    // Account id (Cognito sub) bound to the in-flight purchase via Play's
    // obfuscatedAccountId, so Google ties the purchase to the account (anti-fraud
    // + lets the server correlate a purchase/RTDN back to the right user).
    private var pendingAccountId: String? = null

    override fun getName(): String = "PlayBillingModule"

    @ReactMethod
    fun queryPurchases(promise: Promise) {
        withReadyBillingClient(promise) { client ->
            val params = QueryPurchasesParams.newBuilder()
                .setProductType(BillingClient.ProductType.INAPP)
                .build()

            client.queryPurchasesAsync(params) { result, purchases ->
                if (result.responseCode != BillingResponseCode.OK) {
                    promise.reject(
                        "QUERY_PURCHASES_FAILED",
                        "Could not query purchases: ${result.debugMessage ?: result.responseCode}"
                    )
                    return@queryPurchasesAsync
                }

                val out = Arguments.createArray()
                purchases.forEach { purchase ->
                    val productId = purchase.products.firstOrNull().orEmpty()
                    val token = purchase.purchaseToken.orEmpty()
                    if (productId.isNotBlank() && token.isNotBlank()) {
                        val item = Arguments.createMap().apply {
                            putString("purchaseToken", token)
                            putString("productId", productId)
                            putInt("purchaseState", purchase.purchaseState)
                            putBoolean("isAcknowledged", purchase.isAcknowledged)
                        }
                        out.pushMap(item)
                    }
                }
                promise.resolve(out)
            }
        }
    }

    @ReactMethod
    fun getProductDetails(skus: ReadableArray, promise: Promise) {
        val skuList = mutableListOf<String>()
        for (i in 0 until skus.size()) {
            val s = skus.getString(i)?.trim()
            if (!s.isNullOrBlank()) skuList.add(s)
        }
        if (skuList.isEmpty()) {
            promise.resolve(Arguments.createArray())
            return
        }

        withReadyBillingClient(promise) { client ->
            val products = skuList.map {
                QueryProductDetailsParams.Product.newBuilder()
                    .setProductId(it)
                    .setProductType(BillingClient.ProductType.INAPP)
                    .build()
            }
            val params = QueryProductDetailsParams.newBuilder()
                .setProductList(products)
                .build()

            client.queryProductDetailsAsync(params) { result, productDetailsList ->
                if (result.responseCode != BillingResponseCode.OK) {
                    promise.reject(
                        "QUERY_PRODUCTS_FAILED",
                        "Could not query billing products: ${result.debugMessage ?: result.responseCode}"
                    )
                    return@queryProductDetailsAsync
                }

                val out = Arguments.createArray()
                productDetailsList.forEach { details ->
                    val offer = details.oneTimePurchaseOfferDetails
                    val item = Arguments.createMap().apply {
                        putString("sku", details.productId)
                        putString("title", details.title)
                        putString("description", details.description)
                        putString("formattedPrice", offer?.formattedPrice ?: "")
                        putString("priceCurrencyCode", offer?.priceCurrencyCode ?: "")
                        // priceAmountMicros is a Long; pass as string to avoid JS int overflow.
                        putString("priceAmountMicros", (offer?.priceAmountMicros ?: 0L).toString())
                    }
                    out.pushMap(item)
                }
                promise.resolve(out)
            }
        }
    }

    @ReactMethod
    fun consumePurchase(purchaseToken: String, promise: Promise) {
        val token = purchaseToken.trim()
        if (token.isBlank()) {
            promise.reject("INVALID_PURCHASE_TOKEN", "purchaseToken is required")
            return
        }

        withReadyBillingClient(promise) { client ->
            val params = ConsumeParams.newBuilder()
                .setPurchaseToken(token)
                .build()

            client.consumeAsync(params) { result, consumedToken ->
                if (result.responseCode != BillingResponseCode.OK) {
                    promise.reject(
                        "CONSUME_FAILED",
                        "Could not consume purchase: ${result.debugMessage ?: result.responseCode}"
                    )
                    return@consumeAsync
                }

                val out = Arguments.createMap().apply {
                    putBoolean("ok", true)
                    putString("purchaseToken", consumedToken ?: token)
                }
                promise.resolve(out)
            }
        }
    }

    @ReactMethod
    fun launchPurchase(sku: String, obfuscatedAccountId: String, promise: Promise) {
        val normalizedSku = sku.trim()
        if (normalizedSku.isBlank()) {
            promise.reject("INVALID_SKU", "SKU is required")
            return
        }

        val activity = reactApplicationContext.currentActivity
        if (activity == null) {
            promise.reject("NO_ACTIVITY", "No active Android activity for billing flow")
            return
        }

        if (pendingPromise != null) {
            promise.reject("BILLING_BUSY", "A purchase flow is already in progress")
            return
        }

        pendingPromise = promise
        pendingSku = normalizedSku
        pendingAccountId = obfuscatedAccountId.trim().ifBlank { null }

        val client = billingClient ?: BillingClient.newBuilder(reactContext)
            .setListener(this)
            .enablePendingPurchases(PendingPurchasesParams.newBuilder().enableOneTimeProducts().build())
            .build()
            .also { billingClient = it }

        val onReady = {
            queryAndLaunch(client, normalizedSku)
        }

        if (client.isReady) {
            onReady()
            return
        }

        client.startConnection(object : BillingClientStateListener {
            override fun onBillingServiceDisconnected() {
                rejectPending("BILLING_DISCONNECTED", "Billing service disconnected")
            }

            override fun onBillingSetupFinished(result: BillingResult) {
                if (result.responseCode == BillingResponseCode.OK) {
                    onReady()
                } else {
                    rejectPending(
                        "BILLING_SETUP_FAILED",
                        "Billing setup failed: ${result.debugMessage ?: result.responseCode}"
                    )
                }
            }
        })
    }

    /**
     * Launch the Google Play SUBSCRIPTION purchase flow. For a base plan that has a
     * free-trial offer, Google shows the "£0 today, renews on <date>" sheet. Returns
     * { sku, purchaseToken, storeTransactionId } on success (server verifies it).
     */
    @ReactMethod
    fun launchSubscription(sku: String, obfuscatedAccountId: String, promise: Promise) {
        val normalizedSku = sku.trim()
        if (normalizedSku.isBlank()) {
            promise.reject("INVALID_SKU", "SKU is required")
            return
        }

        if (reactApplicationContext.currentActivity == null) {
            promise.reject("NO_ACTIVITY", "No active Android activity for billing flow")
            return
        }

        if (pendingPromise != null) {
            promise.reject("BILLING_BUSY", "A purchase flow is already in progress")
            return
        }

        pendingPromise = promise
        pendingSku = normalizedSku
        pendingAccountId = obfuscatedAccountId.trim().ifBlank { null }

        val client = billingClient ?: BillingClient.newBuilder(reactContext)
            .setListener(this)
            .enablePendingPurchases(PendingPurchasesParams.newBuilder().enableOneTimeProducts().build())
            .build()
            .also { billingClient = it }

        val onReady = { queryAndLaunchSubscription(client, normalizedSku) }

        if (client.isReady) {
            onReady()
            return
        }

        client.startConnection(object : BillingClientStateListener {
            override fun onBillingServiceDisconnected() {
                rejectPending("BILLING_DISCONNECTED", "Billing service disconnected")
            }

            override fun onBillingSetupFinished(result: BillingResult) {
                if (result.responseCode == BillingResponseCode.OK) {
                    onReady()
                } else {
                    rejectPending(
                        "BILLING_SETUP_FAILED",
                        "Billing setup failed: ${result.debugMessage ?: result.responseCode}"
                    )
                }
            }
        })
    }

    /** Query the user's active SUBSCRIPTION purchases (used for restore after reinstall). */
    @ReactMethod
    fun querySubscriptions(promise: Promise) {
        withReadyBillingClient(promise) { client ->
            val params = QueryPurchasesParams.newBuilder()
                .setProductType(BillingClient.ProductType.SUBS)
                .build()

            client.queryPurchasesAsync(params) { result, purchases ->
                if (result.responseCode != BillingResponseCode.OK) {
                    promise.reject(
                        "QUERY_SUBSCRIPTIONS_FAILED",
                        "Could not query subscriptions: ${result.debugMessage ?: result.responseCode}"
                    )
                    return@queryPurchasesAsync
                }

                val out = Arguments.createArray()
                purchases.forEach { purchase ->
                    val productId = purchase.products.firstOrNull().orEmpty()
                    val token = purchase.purchaseToken.orEmpty()
                    if (productId.isNotBlank() && token.isNotBlank()) {
                        val item = Arguments.createMap().apply {
                            putString("purchaseToken", token)
                            putString("productId", productId)
                            putInt("purchaseState", purchase.purchaseState)
                            putBoolean("isAcknowledged", purchase.isAcknowledged)
                            putBoolean("isAutoRenewing", purchase.isAutoRenewing)
                        }
                        out.pushMap(item)
                    }
                }
                promise.resolve(out)
            }
        }
    }

    private fun queryAndLaunchSubscription(client: BillingClient, sku: String) {
        val product = QueryProductDetailsParams.Product.newBuilder()
            .setProductId(sku)
            .setProductType(BillingClient.ProductType.SUBS)
            .build()

        val params = QueryProductDetailsParams.newBuilder()
            .setProductList(listOf(product))
            .build()

        client.queryProductDetailsAsync(params) { result, productDetailsList ->
            if (result.responseCode != BillingResponseCode.OK) {
                rejectPending(
                    "QUERY_PRODUCTS_FAILED",
                    "Could not query subscription products: ${result.debugMessage ?: result.responseCode}"
                )
                return@queryProductDetailsAsync
            }

            val details = productDetailsList.firstOrNull { it.productId == sku }
            if (details == null) {
                rejectPending("SKU_NOT_FOUND", "Subscription product not found for sku: $sku")
                return@queryProductDetailsAsync
            }

            launchSubscriptionFlow(client, details)
        }
    }

    private fun launchSubscriptionFlow(client: BillingClient, productDetails: ProductDetails) {
        val activity = reactApplicationContext.currentActivity
        if (activity == null) {
            rejectPending("NO_ACTIVITY", "No active Android activity for billing flow")
            return
        }

        val offers = productDetails.subscriptionOfferDetails.orEmpty()
        // Prefer an offer that includes a free pricing phase (the free trial); fall
        // back to the first available base-plan offer so non-eligible users can still
        // subscribe at the standard price.
        val chosenOffer = offers.firstOrNull { offer ->
            offer.pricingPhases.pricingPhaseList.any { it.priceAmountMicros == 0L }
        } ?: offers.firstOrNull()

        if (chosenOffer == null) {
            rejectPending("NO_OFFER", "No subscription offer available for ${productDetails.productId}")
            return
        }

        val productParams = BillingFlowParams.ProductDetailsParams.newBuilder()
            .setProductDetails(productDetails)
            .setOfferToken(chosenOffer.offerToken)
            .build()

        val flowParamsBuilder = BillingFlowParams.newBuilder()
            .setProductDetailsParamsList(listOf(productParams))
        pendingAccountId?.let { flowParamsBuilder.setObfuscatedAccountId(it) }
        val flowParams = flowParamsBuilder.build()

        val launchResult = client.launchBillingFlow(activity, flowParams)
        if (launchResult.responseCode != BillingResponseCode.OK) {
            rejectPending(
                "LAUNCH_FAILED",
                "Subscription flow launch failed: ${launchResult.debugMessage ?: launchResult.responseCode}"
            )
        }
    }

    private fun withReadyBillingClient(promise: Promise, action: (BillingClient) -> Unit) {
        val client = billingClient ?: BillingClient.newBuilder(reactContext)
            .setListener(this)
            .enablePendingPurchases(PendingPurchasesParams.newBuilder().enableOneTimeProducts().build())
            .build()
            .also { billingClient = it }

        if (client.isReady) {
            action(client)
            return
        }

        client.startConnection(object : BillingClientStateListener {
            override fun onBillingServiceDisconnected() {
                promise.reject("BILLING_DISCONNECTED", "Billing service disconnected")
            }

            override fun onBillingSetupFinished(result: BillingResult) {
                if (result.responseCode == BillingResponseCode.OK) {
                    action(client)
                } else {
                    promise.reject(
                        "BILLING_SETUP_FAILED",
                        "Billing setup failed: ${result.debugMessage ?: result.responseCode}"
                    )
                }
            }
        })
    }

    private fun queryAndLaunch(client: BillingClient, sku: String) {
        val product = QueryProductDetailsParams.Product.newBuilder()
            .setProductId(sku)
            .setProductType(BillingClient.ProductType.INAPP)
            .build()

        val params = QueryProductDetailsParams.newBuilder()
            .setProductList(listOf(product))
            .build()

        client.queryProductDetailsAsync(params) { result, productDetailsList ->
            if (result.responseCode != BillingResponseCode.OK) {
                rejectPending(
                    "QUERY_PRODUCTS_FAILED",
                    "Could not query billing products: ${result.debugMessage ?: result.responseCode}"
                )
                return@queryProductDetailsAsync
            }

            val details = productDetailsList.firstOrNull { it.productId == sku }
            if (details == null) {
                rejectPending("SKU_NOT_FOUND", "Billing product not found for sku: $sku")
                return@queryProductDetailsAsync
            }

            launchFlow(client, details)
        }
    }

    private fun launchFlow(client: BillingClient, productDetails: ProductDetails) {
        val activity = reactApplicationContext.currentActivity
        if (activity == null) {
            rejectPending("NO_ACTIVITY", "No active Android activity for billing flow")
            return
        }

        val productParams = BillingFlowParams.ProductDetailsParams.newBuilder()
            .setProductDetails(productDetails)
            .build()

        val flowParamsBuilder = BillingFlowParams.newBuilder()
            .setProductDetailsParamsList(listOf(productParams))
        pendingAccountId?.let { flowParamsBuilder.setObfuscatedAccountId(it) }
        val flowParams = flowParamsBuilder.build()

        val launchResult = client.launchBillingFlow(activity, flowParams)
        if (launchResult.responseCode != BillingResponseCode.OK) {
            rejectPending(
                "LAUNCH_FAILED",
                "Billing flow launch failed: ${launchResult.debugMessage ?: launchResult.responseCode}"
            )
        }
    }

    override fun onPurchasesUpdated(result: BillingResult, purchases: MutableList<Purchase>?) {
        when (result.responseCode) {
            BillingResponseCode.OK -> {
                val purchase = purchases
                    ?.firstOrNull { it.purchaseState == Purchase.PurchaseState.PURCHASED }
                    ?: purchases?.firstOrNull()

                if (purchase == null) {
                    rejectPending("PURCHASE_EMPTY", "Billing purchase result was empty")
                    return
                }

                if (purchase.purchaseState == Purchase.PurchaseState.PENDING) {
                    rejectPending("PURCHASE_PENDING", "Purchase is pending")
                    return
                }

                val sku = purchase.products.firstOrNull() ?: pendingSku.orEmpty()
                val purchaseToken = purchase.purchaseToken.orEmpty()
                val orderId = purchase.orderId ?: purchaseToken

                if (purchaseToken.isBlank()) {
                    rejectPending("PURCHASE_INVALID", "Purchase token missing from billing result")
                    return
                }

                if (!purchase.isAcknowledged) {
                    val acknowledgeParams = AcknowledgePurchaseParams.newBuilder()
                        .setPurchaseToken(purchaseToken)
                        .build()
                    billingClient?.acknowledgePurchase(acknowledgeParams) { _ ->
                        // Purchase can still be verified server-side even if acknowledge callback is delayed.
                    }
                }

                val map = Arguments.createMap().apply {
                    putString("sku", sku)
                    putString("storeTransactionId", orderId)
                    putString("purchaseToken", purchaseToken)
                }

                val promise = pendingPromise
                pendingPromise = null
                pendingSku = null
                pendingAccountId = null
                promise?.resolve(map)
            }

            BillingResponseCode.USER_CANCELED -> rejectPending("USER_CANCELLED", "Purchase cancelled by user")
            else -> rejectPending(
                "PURCHASE_UPDATE_ERROR",
                "Billing purchase failed: ${result.debugMessage ?: result.responseCode}"
            )
        }
    }

    private fun rejectPending(code: String, message: String) {
        val promise = pendingPromise
        pendingPromise = null
        pendingSku = null
        pendingAccountId = null
        promise?.reject(code, message)
    }
}
