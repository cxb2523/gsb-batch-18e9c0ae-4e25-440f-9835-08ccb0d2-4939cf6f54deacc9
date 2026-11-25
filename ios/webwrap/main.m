// Toontown: Anywhere, web wrapper (test build): nothing but the website's own WASM build in a full-screen WKWebView.
// It loads the same page the Home Screen app loads and the page fetches and caches the game files exactly as the PWA does.
// Nothing about the game lives here, so a fix to the website is a fix to this app.
#import <UIKit/UIKit.h>
#import <WebKit/WebKit.h>
#import <AVFoundation/AVFoundation.h>

#ifndef PAGE_URL
#define PAGE_URL @"https://toontown.puffsco.com/play/?install=0"      // install=0: no "Add to Home Screen" card, this already is an app
#endif

// The app's window scene. UIKit requires the scene lifecycle for apps built with the iOS 27 SDK, and on a two-screen phone (iPhone Duo) the screen
// the app is on is the scene's, not UIScreen.mainScreen's (the two are different displays there).
static UIWindowScene *gScene = nil;
static BOOL TTAWideScene(void) {
    return gScene != nil && gScene.screen.bounds.size.width > [UIScreen mainScreen].bounds.size.width + 1.0;
}

// The margin on the right the page has to keep its buttons inside (the same rules as the native app's TTAInsets): near-square iPhone windows
// (the Duo's inner screen) have a system bar down the right side that swallows taps and is not part of the safe area, and in full-display mode the
// strip beyond the main screen's width does not take taps either. The page reads this as env(safe-area-inset-right) and keeps its own buttons in.
static CGFloat TTARightMargin(CGRect b) {
    CGFloat r = 0;
    if (UI_USER_INTERFACE_IDIOM() == UIUserInterfaceIdiomPhone && b.size.height > 0 && b.size.width / b.size.height < 1.9) r = MAX(44.0, b.size.width * 0.065);
    if (TTAWideScene()) r = MAX(r, (gScene.screen.bounds.size.width - [UIScreen mainScreen].bounds.size.width) / 2.0 + 8.0);
    return r;
}

@interface WebVC : UIViewController <WKNavigationDelegate, WKUIDelegate>
@property (strong, nonatomic) WKWebView *web;
@property (strong, nonatomic) UILabel *note;
@end

@implementation WebVC

- (void)viewDidLoad {
    [super viewDidLoad];
    self.view.backgroundColor = [UIColor colorWithRed:0.35 green:0.62 blue:0.95 alpha:1];
    WKWebViewConfiguration *cfg = [[WKWebViewConfiguration alloc] init];
    cfg.allowsInlineMediaPlayback = YES;
    cfg.mediaTypesRequiringUserActionForPlayback = WKAudiovisualMediaTypeNone;
    cfg.applicationNameForUserAgent = @"TTAWebWrap/1";
    cfg.websiteDataStore = [WKWebsiteDataStore defaultDataStore];       // persistent: the page's file cache survives restarts
    self.web = [[WKWebView alloc] initWithFrame:self.view.bounds configuration:cfg];
    self.web.autoresizingMask = UIViewAutoresizingFlexibleWidth | UIViewAutoresizingFlexibleHeight;
    self.web.navigationDelegate = self;
    self.web.UIDelegate = self;
    self.web.opaque = NO;
    self.web.backgroundColor = self.view.backgroundColor;
    self.web.scrollView.backgroundColor = self.view.backgroundColor;
    self.web.scrollView.contentInsetAdjustmentBehavior = UIScrollViewContentInsetAdjustmentNever;      // the page sizes itself with the safe-area values
    self.web.scrollView.scrollEnabled = NO;
    self.web.scrollView.bounces = NO;
    if (@available(iOS 16.4, *)) self.web.inspectable = YES;           // Safari's Develop menu can attach
    [self.view addSubview:self.web];

    self.note = [[UILabel alloc] init];
    self.note.font = [UIFont boldSystemFontOfSize:14];
    self.note.textColor = [UIColor whiteColor];
    self.note.backgroundColor = [UIColor colorWithWhite:0 alpha:0.7];
    self.note.textAlignment = NSTextAlignmentCenter;
    self.note.layer.cornerRadius = 8; self.note.clipsToBounds = YES;
    self.note.adjustsFontSizeToFitWidth = YES; self.note.minimumScaleFactor = 0.6;
    self.note.hidden = YES;
    [self.view addSubview:self.note];

    [[UIApplication sharedApplication] setIdleTimerDisabled:YES];
    [self load];
}

- (void)load {
    [self.web loadRequest:[NSURLRequest requestWithURL:[NSURL URLWithString:PAGE_URL] cachePolicy:NSURLRequestUseProtocolCachePolicy timeoutInterval:60]];
}

- (void)showNote:(NSString *)t {
    self.note.text = [NSString stringWithFormat:@"  %@  ", t];
    [self.note sizeToFit];
    CGFloat w = MIN(self.view.bounds.size.width - 40, self.note.bounds.size.width + 20), h = 34;
    self.note.frame = CGRectMake((self.view.bounds.size.width - w) / 2, self.view.safeAreaInsets.top + 10, w, h);
    self.note.hidden = NO;
    dispatch_after(dispatch_time(DISPATCH_TIME_NOW, 6 * NSEC_PER_SEC), dispatch_get_main_queue(), ^{ self.note.hidden = YES; });
}

// iOS ended the page's process (almost always memory): quietly start the game page again.
- (void)webViewWebContentProcessDidTerminate:(WKWebView *)webView {
    NSLog(@"TTAWebWrap: web content process ended, reloading");
    [self load];
}

- (void)webView:(WKWebView *)webView didFailProvisionalNavigation:(WKNavigation *)navigation withError:(NSError *)error {
    [self showNote:@"No connection, retrying..."];
    dispatch_after(dispatch_time(DISPATCH_TIME_NOW, 4 * NSEC_PER_SEC), dispatch_get_main_queue(), ^{ [self load]; });
}

- (void)webView:(WKWebView *)webView decidePolicyForNavigationAction:(WKNavigationAction *)action decisionHandler:(void (^)(WKNavigationActionPolicy))handler {
    NSURL *u = action.request.URL;
    BOOL ours = [u.host hasSuffix:@"puffsco.com"] || [u.scheme isEqualToString:@"about"] || [u.scheme isEqualToString:@"blob"] || [u.scheme isEqualToString:@"data"];
    if (action.navigationType == WKNavigationTypeLinkActivated && !ours) {          // a link to another site opens in Safari
        [[UIApplication sharedApplication] openURL:u options:@{} completionHandler:nil];
        handler(WKNavigationActionPolicyCancel);
        return;
    }
    handler(WKNavigationActionPolicyAllow);
}

- (WKWebView *)webView:(WKWebView *)webView createWebViewWithConfiguration:(WKWebViewConfiguration *)c forNavigationAction:(WKNavigationAction *)a windowFeatures:(WKWindowFeatures *)f {
    if (a.request.URL) [[UIApplication sharedApplication] openURL:a.request.URL options:@{} completionHandler:nil];
    return nil;
}

// the page's alert() / confirm() (a web view shows nothing unless the app does)
- (void)webView:(WKWebView *)w runJavaScriptAlertPanelWithMessage:(NSString *)m initiatedByFrame:(WKFrameInfo *)fr completionHandler:(void (^)(void))done {
    UIAlertController *a = [UIAlertController alertControllerWithTitle:nil message:m preferredStyle:UIAlertControllerStyleAlert];
    [a addAction:[UIAlertAction actionWithTitle:@"OK" style:UIAlertActionStyleDefault handler:^(UIAlertAction *x) { done(); }]];
    [self presentViewController:a animated:YES completion:nil];
}
- (void)webView:(WKWebView *)w runJavaScriptConfirmPanelWithMessage:(NSString *)m initiatedByFrame:(WKFrameInfo *)fr completionHandler:(void (^)(BOOL))done {
    UIAlertController *a = [UIAlertController alertControllerWithTitle:nil message:m preferredStyle:UIAlertControllerStyleAlert];
    [a addAction:[UIAlertAction actionWithTitle:@"Cancel" style:UIAlertActionStyleCancel handler:^(UIAlertAction *x) { done(NO); }]];
    [a addAction:[UIAlertAction actionWithTitle:@"OK" style:UIAlertActionStyleDefault handler:^(UIAlertAction *x) { done(YES); }]];
    [self presentViewController:a animated:YES completion:nil];
}

- (void)viewDidLayoutSubviews {
    [super viewDidLayoutSubviews];
    self.web.frame = self.view.bounds;
    // top up the right safe-area margin to what TTARightMargin asks for (the system's own value is left as it is)
    UIEdgeInsets add = self.additionalSafeAreaInsets;
    CGFloat inherent = self.view.safeAreaInsets.right - add.right;
    CGFloat want = MAX(0, TTARightMargin(self.view.bounds) - inherent);
    if (fabs(want - add.right) > 0.5) { add.right = want; self.additionalSafeAreaInsets = add; }
}

- (BOOL)prefersStatusBarHidden { return YES; }
- (BOOL)prefersHomeIndicatorAutoHidden { return YES; }
- (UIRectEdge)preferredScreenEdgesDeferringSystemGestures { return UIRectEdgeAll; }      // (on the Duo in full-display mode iOS otherwise holds back taps at the right edge)
- (UIInterfaceOrientationMask)supportedInterfaceOrientations { return UIInterfaceOrientationMaskLandscape; }

@end

@interface AppDelegate : UIResponder <UIApplicationDelegate>
@end

@implementation AppDelegate
- (BOOL)application:(UIApplication *)app didFinishLaunchingWithOptions:(NSDictionary *)o {
    NSError *e = nil;
    [[AVAudioSession sharedInstance] setCategory:AVAudioSessionCategoryPlayback error:&e];      // sound plays with the silent switch on, as in the native app
    [[AVAudioSession sharedInstance] setActive:YES error:&e];
    return YES;
}
@end

@interface SceneDelegate : UIResponder <UIWindowSceneDelegate>
@property (strong, nonatomic) UIWindow *window;
@end

@implementation SceneDelegate
- (void)scene:(UIScene *)scene willConnectToSession:(UISceneSession *)session options:(UISceneConnectionOptions *)options {
    if (![scene isKindOfClass:[UIWindowScene class]]) return;
    gScene = (UIWindowScene *)scene;
    self.window = [[UIWindow alloc] initWithWindowScene:gScene];       // sized by the scene, which is the right display on a two-screen phone
    self.window.rootViewController = [[WebVC alloc] init];
    [self.window makeKeyAndVisible];
}
@end

int main(int argc, char *argv[]) {
    @autoreleasepool { return UIApplicationMain(argc, argv, nil, NSStringFromClass([AppDelegate class])); }
}
