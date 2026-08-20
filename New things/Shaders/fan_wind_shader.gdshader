shader_type spatial;
render_mode cull_disabled, unshaded, depth_prepass_alpha;

uniform float wind_speed : hint_range(0.0, 5.0) = 1.5;
uniform float wind_strength : hint_range(0.0, 1.0) = 0.8;
uniform vec4 wind_color : source_color = vec4(0.7, 0.9, 1.0, 1.0);
uniform float trail_count : hint_range(3.0, 15.0) = 8.0;
uniform float trail_width : hint_range(0.001, 0.1) = 0.001;
uniform float trail_length : hint_range(0.1, 0.5) = 0.2;
uniform float randomness : hint_range(0.0, 1.0) = 0.7;
uniform float spawn_rate : hint_range(0.5, 5.0) = 2.0;

uniform float alpha_scissor_threshold : hint_range(0.0, 1.0) = 0.001;

// Hash function
float hash(float n) {
    return fract(sin(n) * 43758.5453123);
}

void fragment() {

    vec2 uv = UV;
    float trails = 0.0;

    for (int i = 0; i < 30; i++) {
        if (float(i) >= trail_count) break;

        float trail_id = float(i);
        vec2 seed = vec2(trail_id * 12.345, trail_id * 67.891);

        float random_x = hash(seed.x + seed.y);
        float time_var = hash(seed.x * 3.14159) * 0.2;
        random_x = fract(random_x + time_var * sin(TIME * spawn_rate * 0.3));
        random_x = mix(float(i) / trail_count, random_x, randomness);

        float time_offset = hash(seed.y * 19.753) * 3.0;
        float flow = uv.y - TIME * wind_speed + time_offset;
        float anim = fract(flow);

        float distance_to_trail = abs(uv.x - random_x);
        float this_trail_width = trail_width * (0.7 + 0.6 * hash(seed.x * 7.321));
        float line = smoothstep(this_trail_width, 0.0, distance_to_trail);

        float this_trail_length = trail_length * (0.8 + 0.4 * hash(seed.y * 5.123));
        float trail_vis =
            smoothstep(0.0, 0.1, anim) *
            smoothstep(this_trail_length, 0.0, anim);

        float fade_out = smoothstep(0.5, 0.7, uv.y);
        float intensity_var = 0.6 + 0.5 * hash(seed.x * 13.579);

        line *= trail_vis * (1.0 - fade_out) * intensity_var;

        trails += line;
    }

    // Capsule fade
    float centered_x = (UV.x - 0.5) * 2.0;
    float radial_fade = 1.0 - smoothstep(0.7, 1.0, abs(centered_x));
    float vertical_fade = 1.0 - smoothstep(0.7, 1.0, UV.y);
    radial_fade *= vertical_fade;

    float alpha = trails * radial_fade * wind_strength;

    ALBEDO = wind_color.rgb;
    ALPHA = alpha;
    ALPHA_SCISSOR_THRESHOLD = alpha_scissor_threshold;

    // Optional glow (remove if undesired)
    EMISSION = wind_color.rgb * alpha;
}