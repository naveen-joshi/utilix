import { Component, ChangeDetectionStrategy, signal, computed } from '@angular/core';
import { RouterOutlet, RouterLink, RouterLinkActive } from '@angular/router';
import { ButtonModule } from 'primeng/button';

interface NavItem {
    label: string;
    icon: string;
    route: string;
}

type ThemeMode = 'system' | 'dark' | 'light';

@Component({
    selector: 'app-layout',
    imports: [RouterOutlet, RouterLink, RouterLinkActive, ButtonModule],
    templateUrl: './layout.html',
    styleUrl: './layout.scss',
    changeDetection: ChangeDetectionStrategy.OnPush,
})
export class Layout {
    protected readonly themeMode = signal<ThemeMode>('system');
    protected readonly systemPrefersDark = signal(false);
    protected readonly sidebarCollapsed = signal(false);

    protected readonly navItems: NavItem[] = [
        { label: 'Dashboard', icon: 'pi pi-home', route: '/' },
        { label: 'File Resize', icon: 'pi pi-arrows-h', route: '/resize' },
        { label: 'Image Tools', icon: 'pi pi-images', route: '/image-tools' },
        { label: 'File Convert', icon: 'pi pi-sync', route: '/convert' },
        { label: 'PDF Tools', icon: 'pi pi-file-edit', route: '/pdf-tools' },
        { label: 'Settings', icon: 'pi pi-cog', route: '/settings' },
    ];

    protected readonly isDarkMode = computed(() => {
        const mode = this.themeMode();
        return mode === 'dark' || (mode === 'system' && this.systemPrefersDark());
    });

    protected readonly themeIcon = computed(() => {
        const mode = this.themeMode();
        if (mode === 'system') {
            return 'pi pi-desktop';
        }

        return mode === 'dark' ? 'pi pi-moon' : 'pi pi-sun';
    });

    protected readonly themeLabel = computed(() => {
        const mode = this.themeMode();
        if (mode === 'system') {
            return 'System';
        }

        return mode === 'dark' ? 'Dark' : 'Light';
    });

    protected readonly sidebarWidth = computed(() =>
        this.sidebarCollapsed() ? '64px' : 'var(--sidebar-width)'
    );

    constructor() {
        if (typeof window === 'undefined') {
            return;
        }

        const storedTheme = window.localStorage.getItem('utilix-theme-mode');
        if (storedTheme === 'system' || storedTheme === 'dark' || storedTheme === 'light') {
            this.themeMode.set(storedTheme);
        }

        const mediaQuery = window.matchMedia('(prefers-color-scheme: dark)');
        this.systemPrefersDark.set(mediaQuery.matches);
        mediaQuery.addEventListener('change', event => {
            this.systemPrefersDark.set(event.matches);
            if (this.themeMode() === 'system') {
                this.applyThemeClass();
            }
        });

        this.applyThemeClass();
    }

    toggleThemeMode(): void {
        const current = this.themeMode();
        const nextMode: ThemeMode =
            current === 'system' ? 'dark' : current === 'dark' ? 'light' : 'system';

        this.themeMode.set(nextMode);

        if (typeof window !== 'undefined') {
            window.localStorage.setItem('utilix-theme-mode', nextMode);
        }

        this.applyThemeClass();
    }

    private applyThemeClass(): void {
        document.documentElement.classList.toggle('dark-mode', this.isDarkMode());
    }

    toggleSidebar(): void {
        this.sidebarCollapsed.update(v => !v);
    }
}
