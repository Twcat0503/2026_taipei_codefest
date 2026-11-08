import 'package:flutter/material.dart';
import 'package:get/get.dart';
import 'package:town_pass/gen/assets.gen.dart';
import 'package:town_pass/page/main/main_view_controller.dart';
import 'package:town_pass/page/home/widget/activity_info/activity_info_widget.dart';
import 'package:town_pass/page/home/widget/city_news/city_news_widget.dart';
import 'package:town_pass/page/home/widget/news/news_banner_widget.dart';
import 'package:town_pass/page/home/widget/subscription/subscription_widget.dart';
import 'package:town_pass/util/tp_app_bar.dart';
import 'package:town_pass/util/tp_agent_entry.dart';
import 'package:town_pass/util/tp_colors.dart';
import 'package:town_pass/util/tp_route.dart';

const _shakeCopy = {'zh': '搖一搖開啟安心助手', 'en': 'Shake to open Care Assistant'};

class HomeView extends GetView<MainViewController> {
  const HomeView({super.key});

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: TPAppBar(
        showLogo: true,
        title: '首頁',
        leading: IconButton(
          icon: Semantics(label: '帳戶', child: Assets.svg.iconPerson.svg()),
          onPressed: () => Get.toNamed(TPRoute.account),
        ),
        backgroundColor: TPColors.white,
      ),
      body: CustomScrollView(
        slivers: [
          const SliverToBoxAdapter(child: TPAgentEntry()),
          if (TPAgentConfig.enabled)
            SliverToBoxAdapter(
              child: Obx(
                () => SwitchListTile.adaptive(
                  title: Text(
                    _shakeCopy[Get.locale?.languageCode == 'en' ? 'en' : 'zh']!,
                  ),
                  value: controller.shakeToAgentEnabled.value,
                  onChanged: controller.setShakeToAgent,
                ),
              ),
            ),
          const _SliverGap(20),
          const SliverToBoxAdapter(child: NewsBannerWidget()),
          const _SliverGap(20),
          const SliverToBoxAdapter(child: ActivityInfoWidget()),
          const _SliverGap(8),
          const SliverToBoxAdapter(child: CityNewsWidget()),
          const _SliverGap(16),
          const SliverToBoxAdapter(child: SubscriptionWidget()),
          const _SliverGap(32),
        ],
      ),
    );
  }
}

class _SliverGap extends StatelessWidget {
  const _SliverGap(this.height);

  final double height;

  @override
  Widget build(BuildContext context) {
    return SliverToBoxAdapter(child: SizedBox(height: height));
  }
}
