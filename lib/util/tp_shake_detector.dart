/// Recognizes three deliberate, opposing acceleration peaks, not one bump.
/// Input is linear acceleration in m/s² (gravity removed); time is monotonic.
class TPShakeDetector {
  static const _thresholdSquared = 12.0 * 12.0;
  Duration? _firstPeak;
  Duration? _lastPeak;
  Duration _cooldownUntil = Duration.zero;
  (double, double, double)? _previous;
  int _peaks = 0;

  void reset() {
    _firstPeak = null;
    _lastPeak = null;
    _previous = null;
    _peaks = 0;
  }

  bool add(double x, double y, double z, Duration time) {
    if (!x.isFinite || !y.isFinite || !z.isFinite || time < _cooldownUntil) {
      return false;
    }
    if (x * x + y * y + z * z < _thresholdSquared) return false;
    if (_firstPeak != null &&
        time - _firstPeak! > const Duration(milliseconds: 1200)) {
      reset();
    }
    if (_lastPeak != null &&
        time - _lastPeak! < const Duration(milliseconds: 100)) {
      return false;
    }
    final previous = _previous;
    if (previous != null &&
        x * previous.$1 + y * previous.$2 + z * previous.$3 >= 0) {
      return false;
    }
    _firstPeak ??= time;
    _lastPeak = time;
    _previous = (x, y, z);
    if (++_peaks < 3) return false;
    reset();
    _cooldownUntil = time + const Duration(seconds: 2);
    return true;
  }
}
