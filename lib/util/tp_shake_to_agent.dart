import 'dart:async';

import 'package:flutter/foundation.dart';
import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:sensors_plus/sensors_plus.dart';
import 'package:town_pass/util/tp_agent_entry.dart';
import 'package:town_pass/util/tp_shake_detector.dart';

/// Listens only while the home tab is visible on the foreground route.
class TPShakeToAgent extends StatefulWidget {
  const TPShakeToAgent({
    super.key,
    required this.enabled,
    required this.child,
    this.events,
    this.openAgent,
    this.elapsed,
  });

  final bool enabled;
  final Widget child;
  final Stream<UserAccelerometerEvent> Function()? events;
  final Future<void> Function()? openAgent;
  final Duration Function()? elapsed;

  @override
  State<TPShakeToAgent> createState() => _TPShakeToAgentState();
}

class _TPShakeToAgentState extends State<TPShakeToAgent>
    with WidgetsBindingObserver {
  static const _feedbackChannel = MethodChannel('town_pass/feedback');
  final _detector = TPShakeDetector();
  final _clock = Stopwatch()..start();
  StreamSubscription<UserAccelerometerEvent>? _subscription;
  bool _currentRoute = false;
  bool _foreground = true;
  bool _opening = false;
  bool _sensorFailed = false;

  @override
  void initState() {
    super.initState();
    WidgetsBinding.instance.addObserver(this);
    final lifecycle = WidgetsBinding.instance.lifecycleState;
    _foreground = lifecycle == null || lifecycle == AppLifecycleState.resumed;
  }

  @override
  void didChangeDependencies() {
    super.didChangeDependencies();
    _currentRoute = ModalRoute.isCurrentOf(context) ?? false;
    _sync();
  }

  @override
  void didUpdateWidget(covariant TPShakeToAgent oldWidget) {
    super.didUpdateWidget(oldWidget);
    if (widget.enabled && !oldWidget.enabled) _sensorFailed = false;
    _sync();
  }

  @override
  void didChangeAppLifecycleState(AppLifecycleState state) {
    _foreground = state == AppLifecycleState.resumed;
    _sync();
  }

  bool get _active =>
      mounted &&
      widget.enabled &&
      TPAgentConfig.enabled &&
      _currentRoute &&
      _foreground &&
      !_opening &&
      !_sensorFailed;

  void _stop() {
    final old = _subscription;
    _subscription = null;
    if (old != null) unawaited(old.cancel().catchError((Object _) {}));
    _detector.reset();
  }

  void _sync() {
    if (!_active) {
      _stop();
      return;
    }
    if (_subscription != null) return;
    if (widget.events == null &&
        (kIsWeb ||
            (defaultTargetPlatform != TargetPlatform.android &&
                defaultTargetPlatform != TargetPlatform.iOS))) {
      return;
    }
    try {
      final events =
          widget.events?.call() ??
          userAccelerometerEventStream(
            samplingPeriod: SensorInterval.gameInterval,
          );
      _subscription = events.listen(
        (event) {
          if (_active &&
              _detector.add(
                event.x,
                event.y,
                event.z,
                widget.elapsed?.call() ?? _clock.elapsed,
              )) {
            unawaited(_open());
          }
        },
        onError: (Object error) {
          _sensorFailed = true;
          _stop();
        },
        cancelOnError: true,
      );
    } catch (_) {
      // Devices without a motion sensor still have the visible assistant button.
      _sensorFailed = true;
      _stop();
    }
  }

  Future<void> _acknowledgeShake() async {
    if (!kIsWeb && defaultTargetPlatform == TargetPlatform.android) {
      try {
        if (await _feedbackChannel.invokeMethod<bool>('shake') == true) return;
      } catch (_) {
        // Older builds can still use Flutter's standard haptic feedback.
      }
    }
    await HapticFeedback.mediumImpact();
  }

  Future<void> _open() async {
    _opening = true;
    _stop();
    try {
      // A missing or unresponsive vibration service must not block navigation.
      await _acknowledgeShake()
          .timeout(const Duration(milliseconds: 200))
          .catchError((Object _) {});
      if (!mounted || !widget.enabled || !_foreground || !_currentRoute) return;
      await (widget.openAgent ?? TPAgentConfig.open)();
    } finally {
      _opening = false;
      if (mounted) _sync();
    }
  }

  @override
  void dispose() {
    WidgetsBinding.instance.removeObserver(this);
    _stop();
    _clock.stop();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) => widget.child;
}
