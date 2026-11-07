import 'dart:collection';

import 'package:flutter/foundation.dart';
import 'package:flutter/gestures.dart';
import 'package:flutter/material.dart';
import 'package:flutter_inappwebview/flutter_inappwebview.dart';
import 'package:get/get.dart';
import 'package:town_pass/util/tp_app_bar.dart';
import 'package:town_pass/util/tp_colors.dart';
import 'package:town_pass/util/tp_external_link.dart';
import 'package:town_pass/util/tp_prefill.dart';
import 'package:town_pass/util/web_message_handler/tp_web_message_listener.dart';
import 'package:url_launcher/url_launcher.dart';

class WebViewArgument {
  final String? url;
  final String? forceTitle;

  /// 開頁後要替民眾填好的欄位（只對台北通站內服務生效，見 tp_prefill.dart）。
  final Map<String, String>? prefill;

  const WebViewArgument({this.url, this.forceTitle, this.prefill});
}

/// App 內開網頁使用，可使用 `openUrl` 並以 `url` 為參數帶入開啟網頁： \
/// `forceTitle` 將會強制套用網頁標題為
///
/// ```
/// Get.toNamed(TPRoute.webView, arguments: url);
/// ```
class TPWebView extends StatelessWidget {
  final TPAppBarController? titleController;

  TPWebView({super.key, this.titleController});

  String get url => (Get.arguments as WebViewArgument?)?.url ?? '';

  String? get forceTitle => (Get.arguments as WebViewArgument?)?.forceTitle;

  Map<String, String>? get prefill =>
      (Get.arguments as WebViewArgument?)?.prefill;

  /// 只在第一次載入完成時填寫，之後民眾自己改的內容不會被蓋掉。
  final RxBool _prefilled = RxBool(false);

  final TPAppBarController _defaultTitleController = TPAppBarController();

  TPAppBarController get appBarController =>
      titleController ?? _defaultTitleController;

  final Rxn<InAppWebViewController> webViewController =
      Rxn<InAppWebViewController>();

  final RxBool canGoBack = RxBool(false);

  /// 帶入失敗時以 SnackBar 提示（TalkBack 會朗讀），沒有失敗的欄位就不顯示。
  void _showPrefillFailure(BuildContext context, Iterable<String> fields) {
    final String? message = prefillFailureMessage(fields);
    if (message == null) return;
    ScaffoldMessenger.maybeOf(context)?.showSnackBar(
      SnackBar(content: Text(message), duration: const Duration(seconds: 10)),
    );
  }

  /// 網頁內還有上一頁就回上一頁，否則離開這個網頁。左上返回鍵與系統返回手勢共用。
  Future<void> _goBack() async {
    final InAppWebViewController? controller = webViewController.value;
    if (controller != null && await controller.canGoBack()) {
      await controller.goBack();
    } else {
      Get.back();
    }
  }

  @override
  Widget build(BuildContext context) {
    return Obx(
      () => PopScope(
        canPop: !canGoBack.value,
        onPopInvokedWithResult: (didPop, _) {
          if (!didPop) _goBack();
        },
        child: _scaffold(context),
      ),
    );
  }

  Widget _scaffold(BuildContext context) {
    return Scaffold(
      appBar: TPAppBar(
        backgroundColor: TPColors.primary500,
        foregroundColor: TPColors.white,
        leading: BackButton(
          color: TPColors.white,
          onPressed: _goBack,
          style: const ButtonStyle(
            iconSize: WidgetStatePropertyAll<double>(24),
          ),
        ),
        actions: [
          CloseButton(
            color: TPColors.white,
            onPressed: () => Get.back(),
            style: const ButtonStyle(
              iconSize: WidgetStatePropertyAll<double>(24),
            ),
          ),
        ],
        title: appBarController.title.value,
        controller: appBarController,
      ),
      body: Stack(
        children: [
          TPInAppWebView(
            initialSettings: InAppWebViewSettings(
              // flutter_inappwebview 預設會呼叫 setTextZoom(100)，把系統字級吃掉；
              // 這裡改傳系統字級，長輩放大字級時 WebView 內的網頁才會跟著放大。
              textZoom: webViewTextZoom(MediaQuery.textScalerOf(context)),
              useShouldOverrideUrlLoading: true,
            ),
            // 網頁內點擊的 intent:// 等連結在這裡攔下。
            shouldOverrideUrlLoading: (controller, action) async {
              final WebUri? target = action.request.url;
              if (target == null ||
                  !action.isForMainFrame ||
                  isWebScheme(target.scheme)) {
                return NavigationActionPolicy.ALLOW;
              }
              await _handOff(controller, target);
              return NavigationActionPolicy.CANCEL;
            },
            // 伺服器轉址（例如 Google 地圖在 WebView 裡轉成 intent://）不會經過上面，
            // 只會以 ERR_UNKNOWN_URL_SCHEME 失敗，所以在這裡補接。
            onReceivedError: (controller, request, error) async {
              if (request.isForMainFrame == false ||
                  isWebScheme(request.url.scheme)) {
                return;
              }
              await _handOff(controller, request.url);
            },
            onWebViewCreated: (controller) {
              webViewController.value = controller;
              try {
                controller.loadUrl(urlRequest: URLRequest(url: WebUri(url)));
              } catch (_) {
                controller.loadData(data: _failedToLoadUrlData(url: url));
              }
            },
            onLoadStop: (controller, page) async {
              final Map<String, String>? values = prefill;
              if (values == null || _prefilled.value) return;
              _prefilled.value = true;
              // 不是台北通站內頁面就不填，並告訴民眾要自己填，不能讓他以為已帶入。
              if (!canPrefill(page)) {
                _showPrefillFailure(context, values.keys);
                return;
              }
              List<String> missing;
              try {
                final CallAsyncJavaScriptResult? result = await controller
                    .callAsyncJavaScript(functionBody: prefillScript(values));
                missing = result == null || result.error != null
                    ? values.keys.toList()
                    : [
                        ...(result.value as List? ?? const [])
                            .whereType<String>(),
                      ];
              } catch (_) {
                missing = values.keys.toList();
              }
              if (context.mounted) _showPrefillFailure(context, missing);
            },
            onUpdateVisitedHistory: (_, _, _) async {
              canGoBack.value =
                  await webViewController.value?.canGoBack() ?? false;
            },
            onTitleChanged: (_, title) {
              appBarController.title.value = switch (forceTitle == null) {
                true => title,
                false => forceTitle,
              };
            },
            onGeolocationPermissionsShowPrompt: (controller, origin) async {
              // should be deal individually (ask for user agreement)
              return GeolocationPermissionShowPromptResponse(
                origin: origin,
                allow: true,
                retain: true,
              );
            },
            onCloseWindow: (_) => Get.back(),
          ),
          Obx(() => _TextZoomSync(controller: webViewController.value)),
        ],
      ),
    );
  }
}

/// 把 WebView 開不了的連結交給系統（地圖 App、撥號等），再離開這次跳轉留下的頁面。
Future<void> _handOff(InAppWebViewController controller, Uri link) async {
  final Uri? target = externalTarget(link);
  if (target != null) {
    await launchUrl(target, mode: LaunchMode.externalApplication);
  }
  // 往回找第一個不屬於這次跳轉的網頁；退回 Google 的轉址頁會再被導走，形成迴圈。
  final WebHistory? history = await controller.getCopyBackForwardList();
  final List<WebHistoryItem> items = history?.list ?? [];
  final int current = history?.currentIndex ?? -1;
  for (int i = current; i >= 0 && i < items.length; i--) {
    final WebUri? url = items[i].url;
    if (url == null || !isWebScheme(url.scheme)) continue;
    if (target != null && url.host == target.host) continue;
    if (i != current) await controller.goBackOrForward(steps: i - current);
    return;
  }
  // 這個頁面只是為了跳轉才開的：關掉它，回到原本的畫面。
  Get.back();
}

/// 系統字級換算成 WebView 的 textZoom（百分比整數，限制在 100～300）。
///
/// 以 16 為基準字級（CSS 預設的 body 字級 16px）取 `scaler.scale(16) / 16`。
/// 不能用 `scale(100)`：Android 14+ 的非線性字級表在 100sp 時固定對應 100dp，
/// 在任何系統字級下結果都約是 100%；而 app 一旦呼叫 setTextZoom，WebView 就不會
/// 再自己跟隨系統字級，網頁就完全不會放大。
/// 呼叫端仍須以 `MediaQuery.textScalerOf(context)` 取得 [scaler]，系統字級改變時
/// 才會觸發 rebuild。
@visibleForTesting
int webViewTextZoom(TextScaler scaler) =>
    (scaler.scale(16) / 16 * 100).round().clamp(100, 300);

/// 使用者在 app 開著時調整系統字級，也要即時同步到 WebView。
class _TextZoomSync extends StatefulWidget {
  const _TextZoomSync({this.controller});

  final InAppWebViewController? controller;

  @override
  State<_TextZoomSync> createState() => _TextZoomSyncState();
}

class _TextZoomSyncState extends State<_TextZoomSync> {
  int? _applied;

  @override
  Widget build(BuildContext context) {
    final int zoom = webViewTextZoom(MediaQuery.textScalerOf(context));
    if (_applied != zoom && widget.controller != null) {
      _applied = zoom;
      // build 期間不可改動原生設定，排到下一幀
      WidgetsBinding.instance.addPostFrameCallback((_) async {
        await widget.controller?.setSettings(
          settings: InAppWebViewSettings(textZoom: zoom),
        );
      });
    }
    return const SizedBox.shrink();
  }
}

class TPInAppWebView extends StatelessWidget {
  final Set<Factory<OneSequenceGestureRecognizer>>? gestureRecognizers;
  final int? windowId;
  final HeadlessInAppWebView? headlessWebView;
  final InAppWebViewKeepAlive? keepAlive;
  final bool? preventGestureDelay;
  final TextDirection? layoutDirection;
  final InAppWebViewInitialData? initialData;
  final String? initialFile;
  final InAppWebViewSettings? initialSettings;
  final URLRequest? initialUrlRequest;
  final UnmodifiableListView<UserScript>? initialUserScripts;
  final PullToRefreshController? pullToRefreshController;
  final FindInteractionController? findInteractionController;
  final ContextMenu? contextMenu;
  final Function(InAppWebViewController, WebUri?)? onPageCommitVisible;
  final Function(InAppWebViewController, String?)? onTitleChanged;
  final Future<AjaxRequestAction> Function(InAppWebViewController, AjaxRequest)?
  onAjaxProgress;
  final Future<AjaxRequestAction?> Function(
    InAppWebViewController,
    AjaxRequest,
  )?
  onAjaxReadyStateChange;
  final Function(InAppWebViewController, ConsoleMessage)? onConsoleMessage;
  final Future<bool?> Function(InAppWebViewController, CreateWindowAction)?
  onCreateWindow;
  final Function(InAppWebViewController)? onCloseWindow;
  final Function(InAppWebViewController)? onWindowFocus;
  final Function(InAppWebViewController)? onWindowBlur;
  final Function(InAppWebViewController, DownloadStartRequest)?
  onDownloadStartRequest;
  final Future<JsAlertResponse?> Function(
    InAppWebViewController,
    JsAlertRequest,
  )?
  onJsAlert;
  final Future<JsConfirmResponse?> Function(
    InAppWebViewController,
    JsConfirmRequest,
  )?
  onJsConfirm;
  final Future<JsPromptResponse?> Function(
    InAppWebViewController,
    JsPromptRequest,
  )?
  onJsPrompt;
  final Function(InAppWebViewController, WebResourceRequest, WebResourceError)?
  onReceivedError;
  final Function(
    InAppWebViewController,
    WebResourceRequest,
    WebResourceResponse,
  )?
  onReceivedHttpError;
  final Function(InAppWebViewController, LoadedResource)? onLoadResource;
  final Future<CustomSchemeResponse?> Function(
    InAppWebViewController,
    WebResourceRequest,
  )?
  onLoadResourceWithCustomScheme;
  final Function(InAppWebViewController, WebUri?)? onLoadStart;
  final Function(InAppWebViewController, WebUri?)? onLoadStop;
  final Function(InAppWebViewController, InAppWebViewHitTestResult)?
  onLongPressHitTestResult;
  final Future<bool?> Function(
    InAppWebViewController,
    WebUri?,
    PlatformPrintJobController?,
  )?
  onPrintRequest;
  final Function(InAppWebViewController, int)? onProgressChanged;
  final Future<ClientCertResponse?> Function(
    InAppWebViewController,
    URLAuthenticationChallenge,
  )?
  onReceivedClientCertRequest;
  final Future<HttpAuthResponse?> Function(
    InAppWebViewController,
    URLAuthenticationChallenge,
  )?
  onReceivedHttpAuthRequest;
  final Future<ServerTrustAuthResponse?> Function(
    InAppWebViewController,
    URLAuthenticationChallenge,
  )?
  onReceivedServerTrustAuthRequest;
  final Function(InAppWebViewController, int, int)? onScrollChanged;
  final Function(InAppWebViewController, WebUri?, bool?)?
  onUpdateVisitedHistory;
  final Function(InAppWebViewController)? onWebViewCreated;
  final Future<AjaxRequest?> Function(InAppWebViewController, AjaxRequest)?
  shouldInterceptAjaxRequest;
  final Future<FetchRequest?> Function(InAppWebViewController, FetchRequest)?
  shouldInterceptFetchRequest;
  final Future<NavigationActionPolicy?> Function(
    InAppWebViewController,
    NavigationAction,
  )?
  shouldOverrideUrlLoading;
  final Function(InAppWebViewController)? onEnterFullscreen;
  final Function(InAppWebViewController)? onExitFullscreen;
  final Function(InAppWebViewController, int, int, bool, bool)? onOverScrolled;
  final Function(InAppWebViewController, double, double)? onZoomScaleChanged;
  final Function(InAppWebViewController)?
  onDidReceiveServerRedirectForProvisionalNavigation;
  final Future<FormResubmissionAction?> Function(
    InAppWebViewController,
    WebUri?,
  )?
  onFormResubmission;
  final Function(InAppWebViewController)? onGeolocationPermissionsHidePrompt;
  final Future<GeolocationPermissionShowPromptResponse?> Function(
    InAppWebViewController,
    String,
  )?
  onGeolocationPermissionsShowPrompt;
  final Future<JsBeforeUnloadResponse?> Function(
    InAppWebViewController,
    JsBeforeUnloadRequest,
  )?
  onJsBeforeUnload;
  final Future<NavigationResponseAction?> Function(
    InAppWebViewController,
    NavigationResponse,
  )?
  onNavigationResponse;
  final Future<PermissionResponse?> Function(
    InAppWebViewController,
    PermissionRequest,
  )?
  onPermissionRequest;
  final Function(InAppWebViewController, Uint8List)? onReceivedIcon;
  final Function(InAppWebViewController, LoginRequest)? onReceivedLoginRequest;
  final Function(InAppWebViewController, PermissionRequest)?
  onPermissionRequestCanceled;
  final Function(InAppWebViewController)? onRequestFocus;
  final Function(InAppWebViewController, WebUri, bool)? onReceivedTouchIconUrl;
  final Function(InAppWebViewController, RenderProcessGoneDetail)?
  onRenderProcessGone;
  final Future<WebViewRenderProcessAction?> Function(
    InAppWebViewController,
    WebUri?,
  )?
  onRenderProcessResponsive;
  final Future<WebViewRenderProcessAction?> Function(
    InAppWebViewController,
    WebUri?,
  )?
  onRenderProcessUnresponsive;
  final Future<SafeBrowsingResponse?> Function(
    InAppWebViewController,
    WebUri,
    SafeBrowsingThreat?,
  )?
  onSafeBrowsingHit;
  final Function(InAppWebViewController)? onWebContentProcessDidTerminate;
  final Future<ShouldAllowDeprecatedTLSAction?> Function(
    InAppWebViewController,
    URLAuthenticationChallenge,
  )?
  shouldAllowDeprecatedTLS;
  final Future<WebResourceResponse?> Function(
    InAppWebViewController,
    WebResourceRequest,
  )?
  shouldInterceptRequest;
  final Future<void> Function(
    InAppWebViewController,
    MediaCaptureState?,
    MediaCaptureState?,
  )?
  onCameraCaptureStateChanged;
  final Future<void> Function(
    InAppWebViewController,
    MediaCaptureState?,
    MediaCaptureState?,
  )?
  onMicrophoneCaptureStateChanged;

  const TPInAppWebView({
    super.key,
    this.gestureRecognizers,
    this.windowId,
    this.headlessWebView,
    this.keepAlive,
    this.preventGestureDelay,
    this.layoutDirection,
    this.initialData,
    this.initialFile,
    this.initialSettings,
    this.initialUrlRequest,
    this.initialUserScripts,
    this.pullToRefreshController,
    this.findInteractionController,
    this.contextMenu,
    this.onPageCommitVisible,
    this.onTitleChanged,
    this.onAjaxProgress,
    this.onAjaxReadyStateChange,
    this.onConsoleMessage,
    this.onCreateWindow,
    this.onCloseWindow,
    this.onWindowFocus,
    this.onWindowBlur,
    this.onDownloadStartRequest,
    this.onJsAlert,
    this.onJsConfirm,
    this.onJsPrompt,
    this.onReceivedError,
    this.onReceivedHttpError,
    this.onLoadResource,
    this.onLoadResourceWithCustomScheme,
    this.onLoadStart,
    this.onLoadStop,
    this.onLongPressHitTestResult,
    this.onPrintRequest,
    this.onProgressChanged,
    this.onReceivedClientCertRequest,
    this.onReceivedHttpAuthRequest,
    this.onReceivedServerTrustAuthRequest,
    this.onScrollChanged,
    this.onUpdateVisitedHistory,
    this.onWebViewCreated,
    this.shouldInterceptAjaxRequest,
    this.shouldInterceptFetchRequest,
    this.shouldOverrideUrlLoading,
    this.onEnterFullscreen,
    this.onExitFullscreen,
    this.onOverScrolled,
    this.onZoomScaleChanged,
    this.onDidReceiveServerRedirectForProvisionalNavigation,
    this.onFormResubmission,
    this.onGeolocationPermissionsHidePrompt,
    this.onGeolocationPermissionsShowPrompt,
    this.onJsBeforeUnload,
    this.onNavigationResponse,
    this.onPermissionRequest,
    this.onReceivedIcon,
    this.onReceivedLoginRequest,
    this.onPermissionRequestCanceled,
    this.onRequestFocus,
    this.onReceivedTouchIconUrl,
    this.onRenderProcessGone,
    this.onRenderProcessResponsive,
    this.onRenderProcessUnresponsive,
    this.onSafeBrowsingHit,
    this.onWebContentProcessDidTerminate,
    this.shouldAllowDeprecatedTLS,
    this.shouldInterceptRequest,
    this.onCameraCaptureStateChanged,
    this.onMicrophoneCaptureStateChanged,
  });

  @override
  Widget build(BuildContext context) {
    return InAppWebView(
      onWebViewCreated: (controller) async {
        await controller.addWebMessageListener(
          TPWebMessageListener.webMessageListener(
            onTtsReply: (reply, targetOrigin) => controller.postWebMessage(
              message: reply,
              targetOrigin: targetOrigin,
            ),
          ),
        );
        onWebViewCreated?.call(controller);
      },
      gestureRecognizers: gestureRecognizers,
      windowId: windowId,
      headlessWebView: headlessWebView,
      keepAlive: keepAlive,
      preventGestureDelay: preventGestureDelay,
      layoutDirection: layoutDirection,
      initialData: initialData,
      initialFile: initialFile,
      initialSettings: initialSettings,
      initialUrlRequest: initialUrlRequest,
      initialUserScripts: initialUserScripts,
      pullToRefreshController: pullToRefreshController,
      findInteractionController: findInteractionController,
      contextMenu: contextMenu,
      onPageCommitVisible: onPageCommitVisible,
      onTitleChanged: onTitleChanged,
      onAjaxProgress: onAjaxProgress,
      onAjaxReadyStateChange: onAjaxReadyStateChange,
      onConsoleMessage: onConsoleMessage,
      onCreateWindow: onCreateWindow,
      onCloseWindow: onCloseWindow,
      onWindowFocus: onWindowFocus,
      onWindowBlur: onWindowBlur,
      onDownloadStartRequest: onDownloadStartRequest,
      onJsAlert: onJsAlert,
      onJsConfirm: onJsConfirm,
      onJsPrompt: onJsPrompt,
      onReceivedError: onReceivedError,
      onReceivedHttpError: onReceivedHttpError,
      onLoadResource: onLoadResource,
      onLoadResourceWithCustomScheme: onLoadResourceWithCustomScheme,
      onLoadStart: onLoadStart,
      onLoadStop: onLoadStop,
      onLongPressHitTestResult: onLongPressHitTestResult,
      onPrintRequest: onPrintRequest,
      onProgressChanged: onProgressChanged,
      onReceivedClientCertRequest: onReceivedClientCertRequest,
      onReceivedHttpAuthRequest: onReceivedHttpAuthRequest,
      onReceivedServerTrustAuthRequest: onReceivedServerTrustAuthRequest,
      onScrollChanged: onScrollChanged,
      onUpdateVisitedHistory: onUpdateVisitedHistory,
      shouldInterceptAjaxRequest: shouldInterceptAjaxRequest,
      shouldInterceptFetchRequest: shouldInterceptFetchRequest,
      shouldOverrideUrlLoading: shouldOverrideUrlLoading,
      onEnterFullscreen: onEnterFullscreen,
      onExitFullscreen: onExitFullscreen,
      onOverScrolled: onOverScrolled,
      onZoomScaleChanged: onZoomScaleChanged,
      onDidReceiveServerRedirectForProvisionalNavigation:
          onDidReceiveServerRedirectForProvisionalNavigation,
      onFormResubmission: onFormResubmission,
      onGeolocationPermissionsHidePrompt: onGeolocationPermissionsHidePrompt,
      onGeolocationPermissionsShowPrompt: onGeolocationPermissionsShowPrompt,
      onJsBeforeUnload: onJsBeforeUnload,
      onNavigationResponse: onNavigationResponse,
      onPermissionRequest: onPermissionRequest,
      onReceivedIcon: onReceivedIcon,
      onReceivedLoginRequest: onReceivedLoginRequest,
      onPermissionRequestCanceled: onPermissionRequestCanceled,
      onRequestFocus: onRequestFocus,
      onReceivedTouchIconUrl: onReceivedTouchIconUrl,
      onRenderProcessGone: onRenderProcessGone,
      onRenderProcessResponsive: onRenderProcessResponsive,
      onRenderProcessUnresponsive: onRenderProcessUnresponsive,
      onSafeBrowsingHit: onSafeBrowsingHit,
      onWebContentProcessDidTerminate: onWebContentProcessDidTerminate,
      shouldAllowDeprecatedTLS: shouldAllowDeprecatedTLS,
      shouldInterceptRequest: shouldInterceptRequest,
      onCameraCaptureStateChanged: onCameraCaptureStateChanged,
      onMicrophoneCaptureStateChanged: onMicrophoneCaptureStateChanged,
    );
  }
}

String _failedToLoadUrlData({String? url}) {
  return '''
  <!DOCTYPE html>
  <html>
  <head>
    <title>Failed to load URL</title>
  </head>
  <body>

  <h1>Failed to load url:</h1>

  <h3>${switch (url) {
    null => '(null)',
    String() when url.isEmpty => '(empty)',
    _ => url,
  }}</h3>

  </body>
  </html>
  ''';
}
