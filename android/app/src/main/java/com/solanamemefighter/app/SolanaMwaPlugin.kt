package com.solanamemefighter.app

import android.content.Context
import android.content.Intent
import android.net.Uri
import android.util.Base64
import com.getcapacitor.JSObject
import com.getcapacitor.Plugin
import com.getcapacitor.PluginCall
import com.getcapacitor.PluginMethod
import com.getcapacitor.annotation.CapacitorPlugin
import com.solana.mobilewalletadapter.clientlib.ActivityResultSender
import com.solana.mobilewalletadapter.clientlib.ConnectionIdentity
import com.solana.mobilewalletadapter.clientlib.MobileWalletAdapter
import com.solana.mobilewalletadapter.clientlib.TransactionResult
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.cancel
import kotlinx.coroutines.launch
import java.nio.charset.StandardCharsets

@CapacitorPlugin(name = "SolanaMwa")
class SolanaMwaPlugin : Plugin() {

    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.Main.immediate)
    private lateinit var walletAdapter: MobileWalletAdapter
    private lateinit var prefs: android.content.SharedPreferences

    override fun load() {
        super.load()
        prefs = context.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE)
        walletAdapter = MobileWalletAdapter(
            connectionIdentity = ConnectionIdentity(
                identityUri = Uri.parse(DEFAULT_IDENTITY_URI),
                iconUri = Uri.parse(DEFAULT_ICON_URI),
                identityName = DEFAULT_IDENTITY_NAME,
            )
        )
        val cachedAuthToken = prefs.getString(KEY_AUTH_TOKEN, null)
        if (!cachedAuthToken.isNullOrBlank()) {
            walletAdapter.authToken = cachedAuthToken
        }
    }

    override fun handleOnDestroy() {
        scope.cancel()
        super.handleOnDestroy()
    }

    override fun handleOnNewIntent(intent: Intent) {
        super.handleOnNewIntent(intent)
        val data = intent.data ?: return
        if (data.scheme == CALLBACK_SCHEME && data.host == CALLBACK_HOST) {
            val payload = JSObject()
            payload.put("uri", data.toString())
            payload.put("scheme", data.scheme)
            payload.put("host", data.host)
            payload.put("path", data.path)
            notifyListeners("walletCallback", payload, true)
        }
    }

    @PluginMethod
    fun isAvailable(call: PluginCall) {
        val intent = Intent(Intent.ACTION_VIEW, Uri.parse("solana-wallet://v1/associate/local"))
        val handlers = context.packageManager.queryIntentActivities(intent, 0)
        val out = JSObject()
        out.put("available", true)
        out.put("platform", "android-native-mwa")
        out.put("hasWalletApp", handlers.isNotEmpty())
        call.resolve(out)
    }

    @PluginMethod
    fun getConnectionState(call: PluginCall) {
        val walletAddress = prefs.getString(KEY_WALLET_ADDRESS, null)
        val hasAuthToken = !prefs.getString(KEY_AUTH_TOKEN, null).isNullOrBlank()
        val out = JSObject()
        out.put("connected", !walletAddress.isNullOrBlank() && hasAuthToken)
        out.put("walletAddress", walletAddress)
        out.put("hasAuthToken", hasAuthToken)
        call.resolve(out)
    }

    @PluginMethod
    fun connect(call: PluginCall) {
        val activity = activity
        if (activity == null) {
            call.reject("Activity unavailable")
            return
        }

        scope.launch {
            try {
                val sender = ActivityResultSender(activity)
                when (val result = walletAdapter.connect(sender)) {
                    is TransactionResult.Success -> {
                        val account = result.authResult.accounts.firstOrNull()
                        if (account == null) {
                            call.reject("Wallet connected but no account returned", "MWA_NO_ACCOUNT")
                            return@launch
                        }
                        val walletAddress = base58Encode(account.publicKey)
                        persistConnection(walletAddress, result.authResult.authToken)
                        val out = JSObject()
                        out.put("walletAddress", walletAddress)
                        out.put("connected", true)
                        out.put("hasAuthToken", !result.authResult.authToken.isNullOrBlank())
                        call.resolve(out)
                    }
                    is TransactionResult.NoWalletFound -> {
                        call.reject("No MWA wallet found on device.", "MWA_NO_WALLET")
                    }
                    is TransactionResult.Failure -> {
                        call.reject(
                            "Wallet connection failed: ${result.e.message}",
                            "MWA_CONNECT_FAILED",
                            result.e
                        )
                    }
                }
            } catch (e: Exception) {
                call.reject("Wallet connection crashed: ${e.message}", "MWA_CONNECT_CRASH", e)
            }
        }
    }

    @PluginMethod
    fun signMessage(call: PluginCall) {
        val message = call.getString("message")?.trim()
        if (message.isNullOrEmpty()) {
            call.reject("message is required")
            return
        }

        val activity = activity
        if (activity == null) {
            call.reject("Activity unavailable")
            return
        }

        scope.launch {
            try {
                val sender = ActivityResultSender(activity)
                when (val result = walletAdapter.transact(sender) { authResult ->
                    signMessagesDetached(
                        arrayOf(message.toByteArray(StandardCharsets.UTF_8)),
                        arrayOf(authResult.accounts.first().publicKey)
                    )
                }) {
                    is TransactionResult.Success -> {
                        val account = result.authResult.accounts.firstOrNull()
                        if (account != null) {
                            val walletAddress = base58Encode(account.publicKey)
                            persistConnection(walletAddress, result.authResult.authToken)
                        }
                        val signedMessage = result.payload
                            .messages
                            .firstOrNull()
                            ?.signatures
                            ?.firstOrNull()
                        if (signedMessage == null) {
                            call.reject("Wallet returned empty signature payload", "MWA_EMPTY_SIGNATURE")
                            return@launch
                        }
                        val out = JSObject()
                        out.put("signatureBase64", Base64.encodeToString(signedMessage, Base64.NO_WRAP))
                        out.put("signatureBase58", base58Encode(signedMessage))
                        out.put("walletAddress", prefs.getString(KEY_WALLET_ADDRESS, null))
                        call.resolve(out)
                    }
                    is TransactionResult.NoWalletFound -> {
                        call.reject("No MWA wallet found on device.", "MWA_NO_WALLET")
                    }
                    is TransactionResult.Failure -> {
                        call.reject(
                            "Message signing failed: ${result.e.message}",
                            "MWA_SIGN_MESSAGE_FAILED",
                            result.e
                        )
                    }
                }
            } catch (e: Exception) {
                call.reject("Message signing crashed: ${e.message}", "MWA_SIGN_MESSAGE_CRASH", e)
            }
        }
    }

    @PluginMethod
    fun signAndSendTransaction(call: PluginCall) {
        val transactionBase64 = call.getString("transactionBase64")?.trim()
        if (transactionBase64.isNullOrEmpty()) {
            call.reject("transactionBase64 is required")
            return
        }

        val txBytes = try {
            Base64.decode(transactionBase64, Base64.DEFAULT)
        } catch (_: IllegalArgumentException) {
            call.reject("transactionBase64 is invalid")
            return
        }

        val activity = activity
        if (activity == null) {
            call.reject("Activity unavailable")
            return
        }

        scope.launch {
            try {
                val sender = ActivityResultSender(activity)
                when (val result = walletAdapter.transact(sender) { _ ->
                    signAndSendTransactions(arrayOf(txBytes))
                }) {
                    is TransactionResult.Success -> {
                        val account = result.authResult.accounts.firstOrNull()
                        if (account != null) {
                            val walletAddress = base58Encode(account.publicKey)
                            persistConnection(walletAddress, result.authResult.authToken)
                        }
                        val signatureBytes = result.payload.signatures.firstOrNull()
                        if (signatureBytes == null) {
                            call.reject("Wallet returned empty transaction signature", "MWA_EMPTY_TX_SIGNATURE")
                            return@launch
                        }
                        val out = JSObject()
                        out.put("signatureBase58", base58Encode(signatureBytes))
                        out.put("signatureBase64", Base64.encodeToString(signatureBytes, Base64.NO_WRAP))
                        out.put("walletAddress", prefs.getString(KEY_WALLET_ADDRESS, null))
                        call.resolve(out)
                    }
                    is TransactionResult.NoWalletFound -> {
                        call.reject("No MWA wallet found on device.", "MWA_NO_WALLET")
                    }
                    is TransactionResult.Failure -> {
                        call.reject(
                            "Transaction signing failed: ${result.e.message}",
                            "MWA_SIGN_AND_SEND_FAILED",
                            result.e
                        )
                    }
                }
            } catch (e: Exception) {
                call.reject("Transaction signing crashed: ${e.message}", "MWA_SIGN_AND_SEND_CRASH", e)
            }
        }
    }

    @PluginMethod
    fun disconnect(call: PluginCall) {
        val activity = activity
        if (activity == null) {
            clearConnection()
            call.resolve(JSObject().put("disconnected", true))
            return
        }

        scope.launch {
            try {
                val sender = ActivityResultSender(activity)
                when (val result = walletAdapter.disconnect(sender)) {
                    is TransactionResult.Success -> {
                        clearConnection()
                        call.resolve(JSObject().put("disconnected", true))
                    }
                    is TransactionResult.NoWalletFound -> {
                        clearConnection()
                        call.resolve(JSObject().put("disconnected", true))
                    }
                    is TransactionResult.Failure -> {
                        clearConnection()
                        call.reject(
                            "Wallet disconnect failed: ${result.e.message}",
                            "MWA_DISCONNECT_FAILED",
                            result.e
                        )
                    }
                }
            } catch (e: Exception) {
                clearConnection()
                call.reject("Wallet disconnect crashed: ${e.message}", "MWA_DISCONNECT_CRASH", e)
            }
        }
    }

    private fun persistConnection(walletAddress: String, authToken: String?) {
        prefs.edit()
            .putString(KEY_WALLET_ADDRESS, walletAddress)
            .putString(KEY_AUTH_TOKEN, authToken)
            .apply()
    }

    private fun clearConnection() {
        prefs.edit()
            .remove(KEY_WALLET_ADDRESS)
            .remove(KEY_AUTH_TOKEN)
            .apply()
        walletAdapter.authToken = null
    }

    private fun base58Encode(input: ByteArray): String {
        if (input.isEmpty()) return ""

        var zeros = 0
        while (zeros < input.size && input[zeros].toInt() == 0) {
            zeros++
        }

        val encoded = CharArray(input.size * 2)
        var encodedStart = encoded.size
        val tmp = input.copyOf()
        var startAt = zeros
        while (startAt < tmp.size) {
            val mod = divmod58(tmp, startAt)
            if (tmp[startAt].toInt() == 0) {
                startAt++
            }
            encoded[--encodedStart] = BASE58_ALPHABET[mod]
        }

        while (encodedStart < encoded.size && encoded[encodedStart] == BASE58_ALPHABET[0]) {
            encodedStart++
        }
        while (zeros-- > 0) {
            encoded[--encodedStart] = BASE58_ALPHABET[0]
        }

        return String(encoded, encodedStart, encoded.size - encodedStart)
    }

    private fun divmod58(number: ByteArray, startAt: Int): Int {
        var remainder = 0
        for (i in startAt until number.size) {
            val digit256 = number[i].toInt() and 0xFF
            val temp = remainder * 256 + digit256
            number[i] = (temp / 58).toByte()
            remainder = temp % 58
        }
        return remainder
    }

    companion object {
        private const val PREFS_NAME = "solana_mwa_state"
        private const val KEY_AUTH_TOKEN = "auth_token"
        private const val KEY_WALLET_ADDRESS = "wallet_address"
        private const val DEFAULT_IDENTITY_URI = "https://sticklash.fun"
        private const val DEFAULT_ICON_URI = "https://sticklash.fun/favicon.ico"
        private const val DEFAULT_IDENTITY_NAME = "SMF StickLash"
        private const val CALLBACK_SCHEME = "com.solanamemefighter.app"
        private const val CALLBACK_HOST = "wallet-callback"
        private const val BASE58_ALPHABET = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz"
    }
}
